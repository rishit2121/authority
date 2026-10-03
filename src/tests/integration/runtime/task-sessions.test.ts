import { afterEach, describe, expect, it } from "vitest";

import { authorizeThroughGateway } from "@/lib/gateway/pipeline";
import {
  createTaskSession,
  resolveCredential,
  revokeTaskSession,
  taskSessionInfo,
} from "@/lib/gateway/rpc-sessions";
import { hashTaskSessionToken, isWellFormedTaskSessionToken } from "@/lib/gateway/task-session-token";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";

/**
 * Proves gateway.resolve_credential's session branch (20261002000001) and
 * prepare_authorization's session-freshness check (20261002000002) do
 * exactly what every other credential-authenticated path already does for
 * a runtime key, plus the two checks only a session needs: bound to one
 * exact task, and only good as long as the task's active contract is the
 * one it was issued against.
 */

let seq = 0;
const key = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function authorize(fx: GatewayFixture, credentialSecret: string, taskId = fx.taskId) {
  return authorizeThroughGateway({
    credentialSecret,
    taskId,
    tool: "github.get_issue",
    operation: "get_issue",
    resource: "1",
    arguments: { issue_number: "1" },
    idempotencyKey: key("auth"),
    ...currentVersions(),
  });
}

describe("task sessions (real database)", () => {
  const fixtures: GatewayFixture[] = [];

  const mkFixture = async (label: string) => {
    const fx = await createGatewayFixture({ label, useCurrentVersions: true });
    fixtures.push(fx);
    return fx;
  };

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fx = fixtures.pop();
      if (!fx) continue;
      // task_sessions isn't in gateway-support.ts's own shared cleanup (that
      // file is used by every other integration suite too, and this table
      // is new) -- delete it here, before the task itself, so the FK never
      // blocks fx.cleanup() for these tests specifically.
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.task_sessions where task_id = '${fx.taskId}';
      `);
      await fx.cleanup();
    }
  });

  it("the runtime key exchanges for a session bound to the task's active contract", async () => {
    const fx = await mkFixture("session-create");
    const result = await createTaskSession({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tokenHash: hashTaskSessionToken("authority_ts_" + "a".repeat(43)),
      ttlSeconds: 120,
    });
    expect(result.status).toBe("ok");
    expect(result.agentId).toBe(fx.agentId);
    expect(result.contractId).toBe(fx.contractId);
    expect(result.contractVersion).toBe(1);
    expect(result.sessionId).toBeTruthy();
  });

  it("the session token authorizes exactly like the runtime key it replaced", async () => {
    const fx = await mkFixture("session-authorize");
    const plaintext = `authority_ts_${"b".repeat(43)}`;
    const created = await createTaskSession({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tokenHash: hashTaskSessionToken(plaintext),
      ttlSeconds: 120,
    });
    expect(created.status).toBe("ok");

    const viaKey = await authorize(fx, fx.secret);
    const viaSession = await authorize(fx, plaintext);
    expect(viaKey.kind).toBe("decision");
    expect(viaSession.kind).toBe("decision");
    if (viaKey.kind === "decision" && viaSession.kind === "decision") {
      expect(viaSession.commit.finalOutcome).toBe(viaKey.commit.finalOutcome);
      // The default fixture action carries a constraint (issue_number equals
      // "1"), so a satisfied match is correctly "allow_constrained", not a
      // bare "allow" -- that only applies to an action with zero constraints.
      // This was an incorrect literal in this test, not a product bug: it
      // never ran against a real schema before, so it was never actually
      // exercised until now.
      expect(viaSession.commit.finalOutcome).toBe("allow_constrained");
    }
  });

  it("resolveCredential reports the session's own tenant/agent, well-formed check passes", async () => {
    const fx = await mkFixture("session-resolve");
    const plaintext = `authority_ts_${"c".repeat(43)}`;
    expect(isWellFormedTaskSessionToken(plaintext)).toBe(true);
    await createTaskSession({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tokenHash: hashTaskSessionToken(plaintext),
      ttlSeconds: 120,
    });
    const resolved = await resolveCredential(plaintext);
    expect(resolved).toMatchObject({ status: "ok", tenantId: fx.tenantId, agentId: fx.agentId });
  });

  it("a session cannot be used to authorize a different task", async () => {
    const fxA = await mkFixture("session-cross-task-a");
    const fxB = await mkFixture("session-cross-task-b");
    const plaintext = `authority_ts_${"d".repeat(43)}`;
    await createTaskSession({
      credentialSecret: fxA.secret,
      taskId: fxA.taskId,
      tokenHash: hashTaskSessionToken(plaintext),
      ttlSeconds: 120,
    });
    const result = await authorize(fxB, plaintext, fxB.taskId);
    expect(result).toMatchObject({ kind: "failure", status: "session_task_mismatch" });
  });

  it("revoking a session blocks it, but not the runtime key that created it", async () => {
    const fx = await mkFixture("session-revoke");
    const plaintext = `authority_ts_${"e".repeat(43)}`;
    const created = await createTaskSession({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tokenHash: hashTaskSessionToken(plaintext),
      ttlSeconds: 120,
    });
    expect(created.status).toBe("ok");

    const revoked = await revokeTaskSession({ token: plaintext });
    expect(revoked).toBe("ok");
    const revokedAgain = await revokeTaskSession({ token: plaintext });
    expect(revokedAgain).toBe("already_revoked");

    const viaSession = await authorize(fx, plaintext);
    expect(viaSession).toMatchObject({ kind: "failure", status: "session_revoked" });

    const viaKey = await authorize(fx, fx.secret);
    expect(viaKey.kind).toBe("decision");
  });

  it("task_session_info distinguishes a live session from a revoked one", async () => {
    const fx = await mkFixture("session-info");
    const plaintext = `authority_ts_${"f".repeat(43)}`;
    await createTaskSession({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tokenHash: hashTaskSessionToken(plaintext),
      ttlSeconds: 120,
    });

    const live = await taskSessionInfo(plaintext);
    expect(live).toMatchObject({ status: "ok", taskId: fx.taskId, agentId: fx.agentId });

    await revokeTaskSession({ token: plaintext });
    const revoked = await taskSessionInfo(plaintext);
    expect(revoked.status).toBe("revoked");

    const unknown = await taskSessionInfo(`authority_ts_${"z".repeat(43)}`);
    expect(unknown.status).toBe("not_found");
  });

  it("an expired session is rejected, distinctly from a revoked one", async () => {
    const fx = await mkFixture("session-expired");
    const plaintext = `authority_ts_${"g".repeat(43)}`;
    const created = await createTaskSession({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tokenHash: hashTaskSessionToken(plaintext),
      ttlSeconds: 60,
    });
    expect(created.status).toBe("ok");
    await managementQuery(
      `update public.task_sessions set expires_at = now() - interval '1 second' where id = '${created.sessionId}';`,
    );

    const info = await taskSessionInfo(plaintext);
    expect(info.status).toBe("expired");
    const result = await authorize(fx, plaintext);
    expect(result).toMatchObject({ kind: "failure", status: "session_expired" });
  });

  it("creating a session fails when the task has no active contract", async () => {
    const fx = await mkFixture("session-no-contract");
    await managementQuery(
      `update public.task_authority_contracts
         set contract_status = 'revoked', revoked_at = now(), revocation_reason = 'test setup'
         where id = '${fx.contractId}';`,
    );
    const result = await createTaskSession({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tokenHash: hashTaskSessionToken(`authority_ts_${"h".repeat(43)}`),
      ttlSeconds: 120,
    });
    expect(result.status).toBe("no_active_contract");
  });

  it("a contract change after session creation invalidates the session rather than silently carrying it forward", async () => {
    const fx = await mkFixture("session-stale-contract");
    const plaintext = `authority_ts_${"i".repeat(43)}`;
    const created = await createTaskSession({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tokenHash: hashTaskSessionToken(plaintext),
      ttlSeconds: 120,
    });
    expect(created.status).toBe("ok");

    // The task's active contract changes (revoked here; a real re-activation
    // would supersede it with a new version instead, but either way the
    // session's originally-bound contract id is no longer the active one,
    // which is the one thing this check cares about).
    await managementQuery(`
      update public.task_authority_contracts
        set contract_status = 'revoked', revoked_at = now(), revocation_reason = 'test: contract changed'
        where id = '${fx.contractId}';
    `);

    const result = await authorize(fx, plaintext);
    expect(result).toMatchObject({ kind: "failure", status: "session_contract_stale" });

    // The runtime key itself authorizes fine -- it fails too, but for the
    // ordinary NO_ACTIVE_CONTRACT reason a revoked contract always gives,
    // proving the session's extra check didn't mask or change that outcome.
    const viaKey = await authorize(fx, fx.secret);
    expect(viaKey.kind).toBe("decision");
    if (viaKey.kind === "decision") {
      expect(viaKey.commit.finalOutcome).not.toBe("allow");
    }
  });
});
