import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { closeGatewayPool } from "@/lib/gateway/db";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";
import { approvalById } from "@/lib/gateway/rpc-github";
import { defaultExecutorDeps, executeGithubOperation } from "@/lib/github/executor";
import { mockGithub } from "@/lib/github/mock";

import { createGatewayFixture, currentVersions, resetSemanticSettings, type GatewayFixture } from "../gateway-support";
import { OWNER_A_EMAIL, OWNER_B_EMAIL, TENANT_A_ID, TENANT_B_ID, managementQuery, signInAs } from "../support";

/**
 * Approval-to-capability: an approval request bound to the exact runtime call,
 * decided by humans under role / self-approval / distinct-approver rules, and a
 * capability minted only after everything is re-checked. Real DB, mock GitHub.
 */

const ACTIONS = JSON.stringify({
  schemaVersion: 1,
  items: ["github.create_branch", "github.delete_branch", "github.get_issue"].map((tool) => ({ tool, constraints: [] })),
});
const ADMIN_EMAIL = "admin.a@authority.test";
const DEV_EMAIL = "dev.a@authority.test";

const ids = {
  owner: "ee000000-0000-4000-8000-0000000000a1",
  admin: "ee000000-0000-4000-8000-0000000000a2",
  dev: "ee000000-0000-4000-8000-0000000000a3",
};

let seq = 0;
const key = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function setClasses(classes: string[]) {
  await managementQuery(`
    insert into public.semantic_settings (tenant_id, runtime_approval_classes)
    values ('${TENANT_A_ID}', '{${classes.join(",")}}')
    on conflict (tenant_id) do update set runtime_approval_classes = excluded.runtime_approval_classes;
  `);
}

async function decide(email: string, requestId: string, decision: "approve" | "reject", tenantId = TENANT_A_ID) {
  const { supabase } = await signInAs(email, tenantId);
  return supabase.rpc("decide_runtime_approval", { p_request_id: requestId, p_decision: decision, p_note: "test" });
}

describe("runtime approval -> capability", () => {
  const fixtures: GatewayFixture[] = [];
  const mk = async (label: string) => {
    const fx = await createGatewayFixture({ label, actions: ACTIONS, maxToolInvocations: 100, useCurrentVersions: true, githubRepo: "acme/widgets" });
    fixtures.push(fx);
    return fx;
  };
  const request = (fx: GatewayFixture, tool: string, args: Record<string, string>, idem: string, extra: Partial<Parameters<typeof authorizeThroughGateway>[0]> = {}) =>
    authorizeThroughGateway({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool,
      operation: tool.split(".")[1],
      resource: "acme/widgets",
      arguments: args,
      idempotencyKey: idem,
      ...currentVersions(),
      ...extra,
    });
  const branchOf = (fx: GatewayFixture, s: string) => `authority/${fx.taskId.replace(/-/g, "").slice(0, 8)}/${s}`;
  const openApproval = async (fx: GatewayFixture, tool = "github.create_branch", args?: Record<string, string>, idem = key("appr")) => {
    const a = args ?? { branch: branchOf(fx, "x") };
    const r = await request(fx, tool, a, idem);
    if (r.kind !== "decision") throw new Error("expected a decision");
    const [row] = (await managementQuery(
      `select id from public.runtime_approval_requests where tool_request_id = '${r.commit.toolRequestId}';`,
    )) as Array<{ id: string }>;
    return { r, approvalId: row?.id, args: a, idem };
  };

  beforeAll(async () => {
    process.env.GITHUB_EXECUTION_MODE = "mock";
    await resetSemanticSettings();
    await setClasses(["medium", "high"]);
    await managementQuery(`
      insert into public.principals (id, tenant_id, kind, display_name, user_id) values
        ('${ids.owner}', '${TENANT_A_ID}', 'human', 'Ada Approver', 'a0000000-0000-4000-8000-000000000001'),
        ('${ids.admin}', '${TENANT_A_ID}', 'human', 'Amin Approver', 'a0000000-0000-4000-8000-000000000002'),
        ('${ids.dev}', '${TENANT_A_ID}', 'human', 'Devi Approver', 'a0000000-0000-4000-8000-000000000003')
      on conflict (id) do nothing;
    `);
  }, 60_000);

  afterAll(async () => {
    for (const f of fixtures) await f.cleanup();
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.principals where id in ('${ids.owner}', '${ids.admin}', '${ids.dev}');
    `).catch(() => undefined);
    await resetSemanticSettings();
    await closeGatewayPool();
  }, 60_000);

  it("holds a policy-gated call as require_approval: no capability, an approval bound to the exact request", async () => {
    const fx = await mk("ap-basic");
    const { r, approvalId } = await openApproval(fx);
    expect(r.commit.finalOutcome).toBe("require_approval");
    expect(r.commit.detOutcome).toBe("allow");
    expect(r.capabilityToken).toBeNull();
    expect(r.commit.reasonCodes).toContain("POLICY_REQUIRES_APPROVAL");
    expect(r.kind === "decision" && r.approval).toMatchObject({ state: "pending", required: 1 });

    const [row] = (await managementQuery(
      `select tool, resource, risk_class, trigger_kind, status, required_approvals, arguments_hash, contract_version from public.runtime_approval_requests where id = '${approvalId}';`,
    )) as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ tool: "github.create_branch", resource: "acme/widgets", risk_class: "medium", trigger_kind: "policy_class", status: "pending", required_approvals: 1 });
    expect(row.arguments_hash).toMatch(/^[0-9a-f]{64}$/);
    const caps = (await managementQuery(`select count(*)::int as n from public.capability_tokens where task_id = '${fx.taskId}';`)) as Array<{ n: number }>;
    expect(caps[0].n).toBe(0);
    // Budget was NOT consumed by a request that was never allowed.
    const budget = (await managementQuery(`select count(*)::int as n from public.capabilities where task_id = '${fx.taskId}';`)) as Array<{ n: number }>;
    expect(budget[0].n).toBe(0);
  });

  it("mints the capability only after approval, on the agent's re-request, and it executes", async () => {
    const fx = await mk("ap-mint");
    const { approvalId, args, idem } = await openApproval(fx);
    const before = await request(fx, "github.create_branch", args, idem);
    if (before.kind !== "decision") throw new Error("decision");
    expect(before.capabilityToken).toBeNull(); // still pending

    const res = await decide(OWNER_A_EMAIL, approvalId, "approve");
    expect(res.error).toBeNull();
    expect(res.data).toBe("approved");

    // The approval alone minted nothing.
    expect(((await managementQuery(`select count(*)::int as n from public.capability_tokens where task_id = '${fx.taskId}';`)) as Array<{ n: number }>)[0].n).toBe(0);

    const minted = await request(fx, "github.create_branch", args, idem);
    if (minted.kind !== "decision" || !minted.capabilityToken) throw new Error("expected a minted capability");
    expect(minted.commit.finalOutcome).toBe("allow");
    expect(minted.commit.reasonCodes).toContain("APPROVAL_GRANTED");
    const [cap] = (await managementQuery(
      `select approval_request_id from public.capability_tokens where token_hash = '${hashCapabilityToken(minted.capabilityToken)}';`,
    )) as Array<{ approval_request_id: string }>;
    expect(cap.approval_request_id).toBe(approvalId);

    const run = await executeGithubOperation(
      { credentialSecret: fx.secret, tokenHash: hashCapabilityToken(minted.capabilityToken), tool: "github.create_branch", operation: "create_branch", resource: "acme/widgets", args, idempotencyKey: key("exec") },
      defaultExecutorDeps,
    );
    expect(run.body).toMatchObject({ result: "succeeded" });

    // Replay after minting: no second token, approval is consumed.
    const again = await request(fx, "github.create_branch", args, idem);
    if (again.kind !== "decision") throw new Error("decision");
    expect(again.capabilityToken).toBeNull();
    expect(again.commit.capabilityId).toBe(minted.commit.capabilityId);
    const state = await approvalById({ credentialSecret: fx.secret, approvalId });
    expect(state.state).toBe("consumed");
  });

  it("a rejection never mints a capability", async () => {
    const fx = await mk("ap-reject");
    const { approvalId, args, idem } = await openApproval(fx);
    expect((await decide(OWNER_A_EMAIL, approvalId, "reject")).data).toBe("rejected");
    const after = await request(fx, "github.create_branch", args, idem);
    if (after.kind !== "decision") throw new Error("decision");
    expect(after.capabilityToken).toBeNull();
    expect(after.commit.finalOutcome).toBe("require_approval");
    // Cannot flip a rejected approval to approved afterwards.
    expect((await decide(ADMIN_EMAIL, approvalId, "approve")).data).toBe("rejected");
    expect(((await managementQuery(`select count(*)::int as n from public.capability_tokens where task_id = '${fx.taskId}';`)) as Array<{ n: number }>)[0].n).toBe(0);
  });

  it("enforces role: developers and viewers cannot decide; another tenant cannot even see it", async () => {
    const fx = await mk("ap-role");
    const { approvalId } = await openApproval(fx);
    const dev = await decide(DEV_EMAIL, approvalId, "approve");
    expect(dev.error?.code).toBe("42501");
    const other = await decide(OWNER_B_EMAIL, approvalId, "approve", TENANT_B_ID);
    expect(other.error?.code).toBe("P0002");
  });

  it("forbids self-approval: the task's principal and the agent's owner cannot decide", async () => {
    const fx = await mk("ap-self");
    await managementQuery(`update public.agents set owner_principal_id = '${ids.admin}' where id = '${fx.agentId}';`);
    const { approvalId } = await openApproval(fx);
    const owner = await decide(ADMIN_EMAIL, approvalId, "approve");
    expect(owner.error?.code).toBe("42501");
    expect(owner.error?.message).toMatch(/own/);

    const fx2 = await mk("ap-self2");
    await managementQuery(`update public.tasks set principal_id = '${ids.owner}' where id = '${fx2.taskId}';`);
    const second = await openApproval(fx2);
    expect((await decide(OWNER_A_EMAIL, second.approvalId, "approve")).error?.code).toBe("42501");
    expect((await decide(ADMIN_EMAIL, second.approvalId, "approve")).data).toBe("approved");
  });

  it("requires two DISTINCT approvers for a high-risk call", async () => {
    const fx = await mk("ap-two");
    const { approvalId, r } = await openApproval(fx, "github.delete_branch", { branch: "authority/x/old" });
    expect(r.kind === "decision" && r.commit.finalOutcome).toBe("require_approval");
    expect((await decide(OWNER_A_EMAIL, approvalId, "approve")).data).toBe("pending");
    const dup = await decide(OWNER_A_EMAIL, approvalId, "approve");
    expect(dup.error?.code).toBe("23505");
    expect((await decide(ADMIN_EMAIL, approvalId, "approve")).data).toBe("approved");
  });

  describe("stale approvals", () => {
    it("goes stale if tenant policy changes before the decision", async () => {
      const fx = await mk("ap-stale-pre");
      const { approvalId } = await openApproval(fx);
      await setClasses(["high"]);
      try {
        expect((await decide(OWNER_A_EMAIL, approvalId, "approve")).data).toBe("stale");
      } finally {
        await setClasses(["medium", "high"]);
      }
      const [row] = (await managementQuery(`select status, stale_reason from public.runtime_approval_requests where id = '${approvalId}';`)) as Array<{ status: string; stale_reason: string }>;
      expect(row).toMatchObject({ status: "stale", stale_reason: "CONTEXT_CHANGED" });
    });

    it("does not mint when policy, integration permissions, or the contract changed after approval", async () => {
      const cases: Array<[string, string, string]> = [
        ["policy", `update public.semantic_settings set runtime_approval_classes = '{medium,high}', mode = 'shadow' where tenant_id = '${TENANT_A_ID}'`, `update public.semantic_settings set mode = 'off' where tenant_id = '${TENANT_A_ID}'`],
        ["integration", `update public.github_installations set granted_permissions = granted_permissions || '{"administration":"write"}' where tenant_id = '${TENANT_A_ID}' and status = 'active'`, `update public.github_installations set granted_permissions = granted_permissions - 'administration' where tenant_id = '${TENANT_A_ID}' and status = 'active'`],
      ];
      for (const [label, breakIt, restore] of cases) {
        const fx = await mk(`ap-stale-${label}`);
        const { approvalId, args, idem } = await openApproval(fx);
        expect((await decide(OWNER_A_EMAIL, approvalId, "approve")).data, label).toBe("approved");
        await managementQuery(breakIt);
        try {
          const r = await request(fx, "github.create_branch", args, idem);
          if (r.kind !== "decision") throw new Error("decision");
          expect(r.capabilityToken, label).toBeNull();
        } finally {
          await managementQuery(restore);
        }
        const [row] = (await managementQuery(`select status, stale_reason from public.runtime_approval_requests where id = '${approvalId}';`)) as Array<{ status: string; stale_reason: string }>;
        expect(row, label).toMatchObject({ status: "stale", stale_reason: "CONTEXT_CHANGED" });
      }
    });

    it("does not mint when the contract is superseded or the task is no longer executable", async () => {
      const fx = await mk("ap-stale-contract");
      const { approvalId, args, idem } = await openApproval(fx);
      await decide(OWNER_A_EMAIL, approvalId, "approve");
      await managementQuery(`update public.tasks set status = 'terminated', terminated_at = now() where id = '${fx.taskId}';`);
      const r = await request(fx, "github.create_branch", args, idem);
      if (r.kind !== "decision") throw new Error("decision");
      expect(r.capabilityToken).toBeNull();
      expect(((await managementQuery(`select status from public.runtime_approval_requests where id = '${approvalId}';`)) as Array<{ status: string }>)[0].status).toBe("stale");
    });

    it("cannot be replayed with different arguments", async () => {
      const fx = await mk("ap-args");
      const { approvalId, idem } = await openApproval(fx);
      await decide(OWNER_A_EMAIL, approvalId, "approve");
      const r = await request(fx, "github.create_branch", { branch: branchOf(fx, "different") }, idem);
      expect(r.kind).toBe("failure");
      expect(r.kind === "failure" && r.status).toBe("idempotency_conflict");
    });

    it("expires: an approval past its deadline can neither be decided nor mint", async () => {
      const fx = await mk("ap-expire");
      const { approvalId, args, idem } = await openApproval(fx);
      await decide(OWNER_A_EMAIL, approvalId, "approve");
      await managementQuery(`
        alter table public.runtime_approval_requests disable trigger runtime_approval_requests_guard;
        update public.runtime_approval_requests set created_at = now() - interval '3 hours', expires_at = now() - interval '2 hours' where id = '${approvalId}';
        alter table public.runtime_approval_requests enable trigger runtime_approval_requests_guard;
      `);
      const r = await request(fx, "github.create_branch", args, idem);
      if (r.kind !== "decision") throw new Error("decision");
      expect(r.capabilityToken).toBeNull();
      expect(((await managementQuery(`select status from public.runtime_approval_requests where id = '${approvalId}';`)) as Array<{ status: string }>)[0].status).toBe("expired");
    });
  });

  it("tells the agent only the state of its own approval", async () => {
    const fx = await mk("ap-agent");
    const other = await mk("ap-agent-other");
    const { approvalId } = await openApproval(fx);
    expect(await approvalById({ credentialSecret: fx.secret, approvalId })).toMatchObject({ state: "pending" });
    expect(await approvalById({ credentialSecret: other.secret, approvalId })).toMatchObject({ state: "not_found" });
    expect((await approvalById({ credentialSecret: "authority_rk_" + "e".repeat(64), approvalId })).status).toBe("invalid_credential");
    mockGithub().log.splice(0);
  });
});
