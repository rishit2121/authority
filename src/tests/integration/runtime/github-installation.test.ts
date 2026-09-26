import { createHmac } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeGatewayPool } from "@/lib/gateway/db";
import { bindTaskRepository, setRepositoryAllowed } from "@/lib/gateway/rpc-github";
import { EXPECTED_PERMISSIONS } from "@/lib/github/constants";
import {
  disconnect,
  handleOAuthCallback,
  handleSetupCallback,
  nonceHash,
  processWebhook,
  refreshInstallation,
  startInstall,
} from "@/lib/github/installation";
import { mockGithub } from "@/lib/github/mock";

import { createGatewayFixture, purgeGithubState, type GatewayFixture } from "../gateway-support";
import { TENANT_A_ID, TENANT_B_ID, managementQuery } from "../support";

/** Installation flow, allowlist, binding, drift, webhooks and disconnect — mock GitHub, real database. */

const ADMIN_A = "a0000000-0000-4000-8000-000000000002"; // admin
const DEV_A = "a0000000-0000-4000-8000-000000000003"; // developer
const VIEWER_A = "a0000000-0000-4000-8000-000000000004";
const OWNER_B = "b0000000-0000-4000-8000-000000000001";

const P = {
  admin: "ff000000-0000-4000-8000-0000000000b2",
  dev: "ff000000-0000-4000-8000-0000000000b3",
  viewer: "ff000000-0000-4000-8000-0000000000b4",
  ownerB: "ff000000-0000-4000-8000-0000000000c1",
};

const SECRET = "mock-webhook-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const hook = (event: string, body: object, delivery = crypto.randomUUID(), signature?: string) => {
  const raw = JSON.stringify(body);
  return processWebhook({ rawBody: raw, signature: signature ?? sign(raw), event, deliveryId: delivery });
};

async function connect(userId = ADMIN_A, tenantId = TENANT_A_ID, installationId = "9001") {
  const started = await startInstall({ tenantId, userId });
  if (started.status !== "ok" || !started.started) return { started };
  const { nonce, verifier } = started.started;
  const setup = await handleSetupCallback({
    tenantId,
    userId,
    cookieNonce: nonce,
    cookieVerifier: verifier,
    urlState: nonce,
    installationId,
  });
  if (setup.kind !== "redirect") return { started, setup };
  const code = new URL(setup.url).searchParams.get("code");
  const oauth = await handleOAuthCallback({
    tenantId,
    userId,
    cookieNonce: nonce,
    cookieVerifier: verifier,
    state: nonce,
    code,
  });
  return { started, setup, oauth, nonce, verifier };
}

const installation = async (tenantId = TENANT_A_ID) =>
  (
    (await managementQuery(
      `select id, github_installation_id, status, mode, health_reasons, granted_permissions from public.github_installations where tenant_id = '${tenantId}' and status <> 'disconnected';`,
    )) as Array<{
      id: string;
      github_installation_id: number;
      status: string;
      mode: string;
      health_reasons: string[];
      granted_permissions: Record<string, string>;
    }>
  )[0];

const repos = async () =>
  (await managementQuery(
    `select id, owner || '/' || name as full_name, allowed, present from public.github_repositories where tenant_id = '${TENANT_A_ID}' order by 2;`,
  )) as Array<{ id: string; full_name: string; allowed: boolean; present: boolean }>;

describe("GitHub installation flow (mock GitHub, real database)", () => {
  const fixtures: GatewayFixture[] = [];

  beforeAll(async () => {
    process.env.GITHUB_EXECUTION_MODE = "mock";
    delete process.env.GITHUB_WEBHOOK_SECRET;
    await purgeGithubState();
    await managementQuery(`
      insert into public.principals (id, tenant_id, kind, display_name, user_id) values
        ('${P.admin}', '${TENANT_A_ID}', 'human', 'Amin Admin', '${ADMIN_A}'),
        ('${P.dev}', '${TENANT_A_ID}', 'human', 'Devi Dev', '${DEV_A}'),
        ('${P.viewer}', '${TENANT_A_ID}', 'human', 'Vera Viewer', '${VIEWER_A}'),
        ('${P.ownerB}', '${TENANT_B_ID}', 'human', 'Bo Owner', '${OWNER_B}')
      on conflict (id) do nothing;
    `);
  }, 60_000);

  beforeEach(() => mockGithub().reset());

  afterAll(async () => {
    for (const f of fixtures) await f.cleanup();
    await purgeGithubState();
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.github_install_states where tenant_id = '${TENANT_B_ID}';
      delete from public.principals where id in ('${P.admin}', '${P.dev}', '${P.viewer}', '${P.ownerB}');
    `).catch(() => undefined);
    await closeGatewayPool();
  }, 60_000);

  describe("connect", () => {
    it("requires the admin role", async () => {
      expect((await startInstall({ tenantId: TENANT_A_ID, userId: DEV_A })).status).toBe("forbidden");
      expect((await startInstall({ tenantId: TENANT_A_ID, userId: VIEWER_A })).status).toBe("forbidden");
    });

    it("stores only a hash of the state nonce, then verifies, maps the tenant and discovers repositories with nothing allowed", async () => {
      await purgeGithubState();
      const r = await connect();
      expect(r.oauth).toMatchObject({ ok: true, health: "active" });
      const stored = (await managementQuery(
        `select nonce_hash, status from public.github_install_states where tenant_id = '${TENANT_A_ID}';`,
      )) as Array<{ nonce_hash: string; status: string }>;
      expect(stored[0]).toMatchObject({ nonce_hash: nonceHash(r.nonce!), status: "completed" });
      expect(JSON.stringify(stored)).not.toContain(r.nonce!);

      expect(await installation()).toMatchObject({
        github_installation_id: 9001,
        mode: "mock",
        status: "active",
      });
      const list = await repos();
      // Restricted to THIS installation: globex/secret and acme/unlisted are not discoverable through it.
      expect(list.map((x) => x.full_name)).toEqual([
        "acme/fault-write-403",
        "acme/fault-write-502",
        "acme/fault-write-timeout",
        "acme/fault-write-timeout-applied",
        "acme/widgets",
      ]);
      expect(list.every((x) => !x.allowed)).toBe(true);
    });

    it("refuses a second installation for the same workspace", async () => {
      const r = await connect();
      expect(r.started.status).toBe("already_connected");
    });
  });

  describe("callback attacks", () => {
    beforeEach(purgeGithubState);

    it("rejects a callback with no cookie, a mismatched URL state, or a nonce that is not this user's", async () => {
      const started = await startInstall({ tenantId: TENANT_A_ID, userId: ADMIN_A });
      const { nonce, verifier } = started.started!;
      const base = {
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        cookieVerifier: verifier,
        installationId: "9001",
      };
      expect(await handleSetupCallback({ ...base, cookieNonce: undefined, urlState: nonce })).toEqual({
        kind: "error",
        code: "invalid_state",
      });
      expect(await handleSetupCallback({ ...base, cookieNonce: nonce, urlState: "x".repeat(43) })).toEqual({
        kind: "error",
        code: "invalid_state",
      });
      // Another user of the same tenant holding a copy of the cookie cannot use the admin's state.
      expect(
        await handleSetupCallback({ ...base, userId: DEV_A, cookieNonce: nonce, urlState: nonce }),
      ).toEqual({ kind: "error", code: "invalid_state" });
      // Tenant B cannot use tenant A's state either.
      expect(
        await handleSetupCallback({
          ...base,
          tenantId: TENANT_B_ID,
          userId: OWNER_B,
          cookieNonce: nonce,
          urlState: nonce,
        }),
      ).toEqual({ kind: "error", code: "invalid_state" });
      expect(await installation()).toBeUndefined();
    });

    it("rejects an installation id the user cannot see (id substitution)", async () => {
      const started = await startInstall({ tenantId: TENANT_A_ID, userId: ADMIN_A });
      const { nonce, verifier } = started.started!;
      // 9002 is another organization's installation, not visible to the mock GitHub user.
      const setup = await handleSetupCallback({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        cookieNonce: nonce,
        cookieVerifier: verifier,
        urlState: nonce,
        installationId: "9002",
      });
      expect(setup.kind).toBe("redirect");
      const oauth = await handleOAuthCallback({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        cookieNonce: nonce,
        cookieVerifier: verifier,
        state: nonce,
        code: "mockcode-verified",
      });
      expect(oauth).toEqual({ ok: false, code: "installation_not_visible" });
      expect(await installation()).toBeUndefined();
      const [s] = (await managementQuery(
        `select status, reject_reason from public.github_install_states where tenant_id = '${TENANT_A_ID}';`,
      )) as Array<{ status: string; reject_reason: string }>;
      expect(s).toMatchObject({ status: "rejected", reject_reason: "INSTALLATION_NOT_VISIBLE_TO_USER" });
    });

    it("rejects a forged OAuth code, a mismatched OAuth state, and a replayed state", async () => {
      const started = await startInstall({ tenantId: TENANT_A_ID, userId: ADMIN_A });
      const { nonce, verifier } = started.started!;
      await handleSetupCallback({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        cookieNonce: nonce,
        cookieVerifier: verifier,
        urlState: nonce,
        installationId: "9001",
      });
      const base = { tenantId: TENANT_A_ID, userId: ADMIN_A, cookieNonce: nonce, cookieVerifier: verifier };
      expect(
        await handleOAuthCallback({ ...base, state: "y".repeat(43), code: "mockcode-verified" }),
      ).toEqual({ ok: false, code: "invalid_state" });
      expect((await handleOAuthCallback({ ...base, state: nonce, code: "forged" })).ok).toBe(false);
      expect(await installation()).toBeUndefined();
      // A state that already completed cannot be replayed.
      const fresh = await connect();
      expect(fresh.oauth).toMatchObject({ ok: true });
      const replay = await handleSetupCallback({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        cookieNonce: fresh.nonce,
        cookieVerifier: fresh.verifier,
        urlState: fresh.nonce!,
        installationId: "9001",
      });
      expect(replay).toEqual({ kind: "error", code: "state_already_used" });
    });

    it("rejects an expired state", async () => {
      const started = await startInstall({ tenantId: TENANT_A_ID, userId: ADMIN_A });
      const { nonce, verifier } = started.started!;
      await managementQuery(
        `update public.github_install_states set created_at = now() - interval '30 minutes', expires_at = now() - interval '15 minutes' where tenant_id = '${TENANT_A_ID}';`,
      );
      const r = await handleSetupCallback({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        cookieNonce: nonce,
        cookieVerifier: verifier,
        urlState: nonce,
        installationId: "9001",
      });
      expect(r).toEqual({ kind: "error", code: "invalid_state" });
    });

    it("never lets one tenant claim an installation another tenant owns", async () => {
      expect((await connect()).oauth).toMatchObject({ ok: true });
      const b = await connect(OWNER_B, TENANT_B_ID, "9001");
      expect(b.setup).toEqual({ kind: "error", code: "installation_unavailable" });
      expect(await installation(TENANT_B_ID)).toBeUndefined();
      const [{ n }] = (await managementQuery(
        `select count(*)::int as n from public.github_installations where github_installation_id = 9001;`,
      )) as Array<{ n: number }>;
      expect(n).toBe(1);
    });

    it("refuses a malformed installation id", async () => {
      const started = await startInstall({ tenantId: TENANT_A_ID, userId: ADMIN_A });
      const { nonce, verifier } = started.started!;
      for (const bad of ["abc", "-1", "1; drop table x", "9".repeat(20), ""]) {
        const r = await handleSetupCallback({
          tenantId: TENANT_A_ID,
          userId: ADMIN_A,
          cookieNonce: nonce,
          cookieVerifier: verifier,
          urlState: nonce,
          installationId: bad || null,
        });
        expect(r, bad).toEqual({ kind: "error", code: "invalid_installation" });
      }
    });
  });

  describe("permission drift", () => {
    beforeEach(purgeGithubState);

    it("marks an over-privileged installation as drifted and disables it", async () => {
      // 9003 carries `administration: write` on top of the expected permissions.
      const r = await connect(ADMIN_A, TENANT_A_ID, "9003");
      expect(r.oauth).toMatchObject({ ok: true, health: "permission_drift" });
      const inst = await installation();
      expect(inst).toMatchObject({ status: "permission_drift" });
      expect(inst.health_reasons).toContain("PERMISSION_EXTRA:administration");
    });

    it("detects later drift on re-verification and recovers when the extra permission is removed", async () => {
      await connect();
      const inst = await installation();
      expect(inst.status).toBe("active");
      mockGithub().installations.get(9001)!.permissions.secrets = "write";
      const drift = await refreshInstallation({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        installationRowId: inst.id,
        githubInstallationId: "9001",
      });
      expect(drift).toMatchObject({ health: "permission_drift" });
      expect(drift.reasons).toContain("PERMISSION_EXTRA:secrets");

      delete mockGithub().installations.get(9001)!.permissions.secrets;
      mockGithub().installations.get(9001)!.permissions.contents = "read"; // downgraded
      const missing = await refreshInstallation({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        installationRowId: inst.id,
        githubInstallationId: "9001",
      });
      expect(missing.reasons).toContain("PERMISSION_MISSING:contents");

      mockGithub().installations.get(9001)!.permissions = { ...EXPECTED_PERMISSIONS };
      expect(
        await refreshInstallation({
          tenantId: TENANT_A_ID,
          userId: ADMIN_A,
          installationRowId: inst.id,
          githubInstallationId: "9001",
        }),
      ).toMatchObject({ health: "active" });
    });

    it("reports a suspended installation and one GitHub no longer knows", async () => {
      await connect();
      const inst = await installation();
      mockGithub().installations.get(9001)!.suspended = true;
      expect(
        await refreshInstallation({
          tenantId: TENANT_A_ID,
          userId: ADMIN_A,
          installationRowId: inst.id,
          githubInstallationId: "9001",
        }),
      ).toMatchObject({ health: "suspended" });
      mockGithub().installations.delete(9001);
      const gone = await refreshInstallation({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        installationRowId: inst.id,
        githubInstallationId: "9001",
      });
      expect(gone.health).toBe("permission_drift");
    });
  });

  describe("allowlist and task binding", () => {
    let fx: GatewayFixture;
    beforeAll(async () => {
      mockGithub().reset();
      await purgeGithubState();
      await connect();
      fx = await createGatewayFixture({ label: "gh-bind" });
      fixtures.push(fx);
    }, 60_000);

    it("lets only an admin change the allowlist", async () => {
      const widgets = (await repos()).find((r) => r.full_name === "acme/widgets")!;
      expect(
        await setRepositoryAllowed({
          tenantId: TENANT_A_ID,
          userId: DEV_A,
          repositoryId: widgets.id,
          allowed: true,
        }),
      ).toBe("forbidden");
      expect(
        await setRepositoryAllowed({
          tenantId: TENANT_A_ID,
          userId: ADMIN_A,
          repositoryId: widgets.id,
          allowed: true,
        }),
      ).toBe("ok");
      expect(
        await setRepositoryAllowed({
          tenantId: TENANT_A_ID,
          userId: ADMIN_A,
          repositoryId: crypto.randomUUID(),
          allowed: true,
        }),
      ).toBe("not_found");
    });

    it("binds a task only to an allowlisted repository, once", async () => {
      const list = await repos();
      const widgets = list.find((r) => r.full_name === "acme/widgets")!;
      const other = list.find((r) => r.full_name === "acme/fault-write-502")!;
      expect(
        await bindTaskRepository({
          tenantId: TENANT_A_ID,
          userId: VIEWER_A,
          taskId: fx.taskId,
          repositoryId: widgets.id,
        }),
      ).toBe("forbidden");
      expect(
        await bindTaskRepository({
          tenantId: TENANT_A_ID,
          userId: DEV_A,
          taskId: fx.taskId,
          repositoryId: other.id,
        }),
      ).toBe("repository_not_allowed");
      expect(
        await bindTaskRepository({
          tenantId: TENANT_A_ID,
          userId: DEV_A,
          taskId: fx.taskId,
          repositoryId: widgets.id,
        }),
      ).toBe("ok");
      expect(
        await bindTaskRepository({
          tenantId: TENANT_A_ID,
          userId: DEV_A,
          taskId: fx.taskId,
          repositoryId: widgets.id,
        }),
      ).toBe("already_bound");
      await expect(
        managementQuery(
          `update public.task_repository_bindings set repository_id = '${other.id}' where task_id = '${fx.taskId}';`,
        ),
      ).rejects.toThrow();
    });

    it("drops the allowlist entry when a repository leaves the installation", async () => {
      const inst = await installation();
      mockGithub().installations.get(9001)!.repoIds = mockGithub()
        .installations.get(9001)!
        .repoIds.filter((id) => id !== 1005);
      await refreshInstallation({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        installationRowId: inst.id,
        githubInstallationId: "9001",
      });
      const gone = (await repos()).find((r) => r.full_name === "acme/fault-write-403")!;
      expect(gone).toMatchObject({ present: false, allowed: false });
      expect(
        await setRepositoryAllowed({
          tenantId: TENANT_A_ID,
          userId: ADMIN_A,
          repositoryId: gone.id,
          allowed: true,
        }),
      ).toBe("not_allowable");
    });

    it("forgets the allowlist entry when a repository is renamed", async () => {
      const inst = await installation();
      const widgets = (await repos()).find((r) => r.full_name === "acme/widgets")!;
      expect(widgets.allowed).toBe(true);
      mockGithub().repos.get(1001)!.name = "widgets-renamed";
      await refreshInstallation({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        installationRowId: inst.id,
        githubInstallationId: "9001",
      });
      const renamed = (await repos()).find((r) => r.full_name === "acme/widgets-renamed")!;
      expect(renamed.allowed).toBe(false);
    });
  });

  describe("webhooks", () => {
    beforeAll(async () => {
      mockGithub().reset();
      await purgeGithubState();
      await connect();
    }, 60_000);

    it("rejects a missing, malformed or wrong signature, and reads nothing from the payload first", async () => {
      const body = JSON.stringify({ action: "suspend", installation: { id: 9001 } });
      for (const sig of [null, "", "sha256=", "sha1=abc", `sha256=${"0".repeat(64)}`, sign(body + " ")]) {
        const r = await processWebhook({
          rawBody: body,
          signature: sig,
          event: "installation",
          deliveryId: crypto.randomUUID(),
        });
        expect(r.http, String(sig)).toBe(401);
      }
      expect((await installation()).status).toBe("active");
    });

    it("suspends on `suspend`, requires re-verification on `unsuspend`, and is idempotent per delivery id", async () => {
      const delivery = crypto.randomUUID();
      expect(
        (await hook("installation", { action: "suspend", installation: { id: 9001 } }, delivery)).body,
      ).toEqual({ status: "applied" });
      expect((await installation()).status).toBe("suspended");
      expect(
        (await hook("installation", { action: "suspend", installation: { id: 9001 } }, delivery)).body,
      ).toEqual({ status: "duplicate_delivery" });

      await hook("installation", { action: "unsuspend", installation: { id: 9001 } });
      const inst = await installation();
      expect(inst).toMatchObject({ status: "permission_drift" });
      expect(inst.health_reasons).toContain("NEEDS_REVERIFICATION");
      expect(
        await refreshInstallation({
          tenantId: TENANT_A_ID,
          userId: null,
          installationRowId: inst.id,
          githubInstallationId: "9001",
        }),
      ).toMatchObject({ health: "active" });
    });

    it("ignores unknown installations, unsupported events and malformed payloads", async () => {
      expect((await hook("installation", { action: "suspend", installation: { id: 424242 } })).body).toEqual({
        status: "ignored_unknown_installation",
      });
      expect((await hook("push", { ref: "x" })).body).toEqual({ status: "ignored" });
      const raw = "not json";
      expect(
        (
          await processWebhook({
            rawBody: raw,
            signature: sign(raw),
            event: "installation",
            deliveryId: crypto.randomUUID(),
          })
        ).http,
      ).toBe(400);
      expect(
        (
          await processWebhook({
            rawBody: "{}",
            signature: sign("{}"),
            event: "installation",
            deliveryId: "short",
          })
        ).http,
      ).toBe(400);
    });

    it("clears the allowlist for repositories removed from the installation", async () => {
      const widgets = (await repos()).find(
        (r) => r.full_name === "acme/widgets-renamed" || r.full_name === "acme/widgets",
      )!;
      await setRepositoryAllowed({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        repositoryId: widgets.id,
        allowed: true,
      });
      const ghId = (await managementQuery(
        `select github_repository_id from public.github_repositories where id = '${widgets.id}';`,
      )) as Array<{ github_repository_id: number }>;
      await hook("installation_repositories", {
        action: "removed",
        installation: { id: 9001 },
        repositories_removed: [{ id: ghId[0].github_repository_id }],
      });
      expect((await repos()).find((r) => r.id === widgets.id)).toMatchObject({
        present: false,
        allowed: false,
      });
    });

    it("disconnects and revokes live capabilities when GitHub deletes the installation", async () => {
      await hook("installation", { action: "deleted", installation: { id: 9001 } });
      expect(await installation()).toBeUndefined();
    });
  });

  describe("disconnect", () => {
    beforeEach(async () => {
      await purgeGithubState();
      await connect();
    });

    it("requires an admin, revokes the tenant's live GitHub capabilities and clears the allowlist", async () => {
      const inst = await installation();
      const { authorizeThroughGateway } = await import("@/lib/gateway/pipeline");
      const { currentVersions } = await import("../gateway-support");
      const fx = await createGatewayFixture({
        label: "gh-disc",
        useCurrentVersions: true,
        actions: '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}',
      });
      fixtures.push(fx);
      const widgets = (await repos()).find(
        (r) => r.full_name === "acme/widgets" || r.full_name === "acme/widgets-renamed",
      )!;
      await setRepositoryAllowed({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        repositoryId: widgets.id,
        allowed: true,
      });
      await bindTaskRepository({
        tenantId: TENANT_A_ID,
        userId: DEV_A,
        taskId: fx.taskId,
        repositoryId: widgets.id,
      });
      const auth = await authorizeThroughGateway({
        credentialSecret: fx.secret,
        taskId: fx.taskId,
        tool: "github.get_issue",
        operation: "get_issue",
        resource: "acme/widgets",
        arguments: { issue_number: "1" },
        idempotencyKey: "disc-1",
        ...currentVersions(),
      });
      expect(auth.kind === "decision" && auth.capabilityToken).toBeTruthy();

      expect(
        (
          await disconnect({
            tenantId: TENANT_A_ID,
            userId: VIEWER_A,
            installationRowId: inst.id,
            alsoUninstall: false,
          })
        ).status,
      ).toBe("forbidden");
      const done = await disconnect({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        installationRowId: inst.id,
        alsoUninstall: true,
      });
      expect(done).toMatchObject({ status: "ok", revokedCapabilities: 1, uninstalled: true });
      expect(mockGithub().installations.has(9001)).toBe(false);
      expect(await installation()).toBeUndefined();
      expect((await repos()).every((r) => !r.allowed)).toBe(true);
      const [cap] = (await managementQuery(
        `select status, revocation_reason from public.capability_tokens where task_id = '${fx.taskId}';`,
      )) as Array<{ status: string; revocation_reason: string }>;
      expect(cap).toMatchObject({ status: "revoked", revocation_reason: "GitHub installation disconnected" });
      // The budget the revoked capability held is returned.
      const [b] = (await managementQuery(
        `select consumed_uses from public.capabilities where task_id = '${fx.taskId}';`,
      )) as Array<{ consumed_uses: number }>;
      expect(b.consumed_uses).toBe(0);
    });
  });
});
