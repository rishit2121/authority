import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeGatewayPool, gatewayQuery } from "@/lib/gateway/db";
import { runCampaign } from "@/lib/validation/engine/campaign";
import * as vl from "@/lib/validation/engine/db";
import { runScenario } from "@/lib/validation/engine/runner";
import { createEnvironment, startCampaign, verifyAcceptedRemediation } from "@/lib/validation/engine/service";
import { SCENARIOS, SCENARIO_BY_KEY } from "@/lib/validation/library";
import { environmentSpecSchema } from "@/lib/validation/schema";

import {
  OWNER_B_EMAIL,
  OWNER_A_EMAIL,
  TENANT_A_ID,
  TENANT_B_ID,
  managementQuery,
  signInAs,
} from "../support";

const ADMIN_A = "a0000000-0000-4000-8000-000000000002";
const DEV_EMAIL = "dev.a@authority.test";
const VIEWER_EMAIL = "viewer.a@authority.test";
const spec = environmentSpecSchema.parse({ schemaVersion: 1 });

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 700));
  }
}

const sandboxCount = async () =>
  (
    (await managementQuery(
      `select count(*)::int as n from public.tenants where validation_sandbox;`,
    )) as Array<{ n: number }>
  )[0].n;

describe("validation lab (real gateway, mock integrations)", () => {
  let envId = "";

  beforeAll(async () => {
    envId = await createEnvironment({
      tenantId: TENANT_A_ID,
      userId: ADMIN_A,
      name: "test env",
      description: null,
      ttlHours: 2,
    });
  }, 60_000);

  afterAll(async () => {
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.validation_campaigns where tenant_id = '${TENANT_A_ID}';
      delete from public.validation_regressions where tenant_id = '${TENANT_A_ID}';
      delete from public.validation_environments where tenant_id = '${TENANT_A_ID}';
      delete from public.validation_scenario_versions where tenant_id = '${TENANT_A_ID}';
    `);
    await closeGatewayPool();
  }, 60_000);

  it("is safe by construction: sandbox functions refuse real tenants, and sandboxes are destroyed", async () => {
    await expect(
      vl.seedSandbox(TENANT_A_ID, { agents: [{ key: "primary" }], contract: {} }),
    ).rejects.toMatchObject({ sqlstate: "42501" });
    await expect(vl.destroySandbox(TENANT_A_ID)).rejects.toMatchObject({ sqlstate: "42501" });
    await expect(vl.applyFault(TENANT_A_ID, "revoke_contract")).rejects.toMatchObject({ sqlstate: "42501" });
    await expect(vl.sandboxEvidence(TENANT_A_ID)).rejects.toMatchObject({ sqlstate: "42501" });
    const before = await sandboxCount();
    const r = await runScenario({
      scenario: SCENARIO_BY_KEY.get("benign-full-pr-workflow")!,
      variant: "baseline",
      seed: 1,
      repetition: 1,
      ownerTenantId: TENANT_A_ID,
      actorUserId: ADMIN_A,
      limits: spec.limits,
      sandboxMinutes: 5,
    });
    expect(r.sandboxDestroyed).toBe(true);
    expect(await sandboxCount()).toBe(before);
    // Nothing of the sandbox leaked into the customer's tenant.
    const leak = (await managementQuery(
      `select count(*)::int as n from public.agents where tenant_id = '${TENANT_A_ID}' and name like 'vl-%';`,
    )) as Array<{ n: number }>;
    expect(leak[0].n).toBe(0);
  }, 60_000);

  it("a sandbox tenant has no members and cannot be seen or joined by any user", async () => {
    const id = await vl.createSandbox({ ownerTenantId: TENANT_A_ID, actorUserId: ADMIN_A, ttlMinutes: 5 });
    try {
      const memberships = (await managementQuery(
        `select count(*)::int as n from public.tenant_memberships where tenant_id = '${id}';`,
      )) as Array<{ n: number }>;
      expect(memberships[0].n).toBe(0);
      const { supabase } = await signInAs(OWNER_A_EMAIL, TENANT_A_ID);
      const seen = await supabase.from("tenants").select("id").eq("id", id);
      expect(seen.data ?? []).toHaveLength(0);
    } finally {
      await vl.destroySandbox(id);
    }
  }, 60_000);

  it("is deterministic: the same seed yields the same decisions, controls and verdicts", async () => {
    const sc = SCENARIO_BY_KEY.get("capability-over-broadening")!;
    const shape = async () => {
      const r = await runScenario({
        scenario: sc,
        variant: "baseline",
        seed: 42,
        repetition: 1,
        ownerTenantId: null,
        actorUserId: null,
        limits: spec.limits,
        sandboxMinutes: 5,
      });
      return r.result.steps.map((s) => ({
        id: s.stepKey,
        v: s.verdict,
        c: s.control,
        d: s.actual.finalDecision,
        x: s.actual.execution,
        code: s.actual.resultCode,
      }));
    };
    expect(await shape()).toEqual(await shape());
  }, 90_000);

  it("contains every attack in the starter pack and reports honest metrics", async () => {
    const report = await runCampaign({
      config: { scenarioKeys: SCENARIOS.map((s) => s.key), variants: ["baseline"], repetitions: 1 },
      spec,
      seed: 1,
      persist: null,
      ownerTenantId: null,
      actorUserId: null,
      concurrency: 3,
    });
    const failing = report.runs.filter((r) => r.result.verdict !== "pass").map((r) => r.result.scenarioKey);
    expect(failing).toEqual([]);
    expect(report.status).toBe("completed");
    expect(report.metrics.synthetic).toBe(true);
    expect(report.metrics.attackContainmentRate).toMatchObject({
      numerator: report.metrics.attackContainmentRate.denominator,
    });
    expect(report.metrics.falseNegativeRate.numerator).toBe(0);
    expect(report.metrics.falsePositiveRate.numerator).toBe(0);
    expect(report.metrics.residualBlastRadius.unauthorizedEffects).toBe(0);
    expect(report.metrics.capabilityReplayResistance.denominator).toBeGreaterThan(0);
    expect(report.metrics.approvalBypassResistance.denominator).toBeGreaterThan(0);
    expect(report.metrics.controlCoverage.controlsExercised).toEqual(
      expect.arrayContaining([
        "argument_constraints",
        "capability",
        "contract_scope",
        "semantic",
        "approval",
        "budget",
        "connector_binding",
        "gateway_auth",
      ]),
    );
    expect(report.metrics.limitations.length).toBeGreaterThan(3);
    expect(await sandboxCount()).toBe(0);
  }, 300_000);

  it("finds a real gap in a weakened configuration, proposes narrowing fixes, and verifies an accepted one", async () => {
    const campaignId = await startCampaign({
      tenantId: TENANT_A_ID,
      userId: ADMIN_A,
      environmentId: envId,
      environmentSpec: spec,
      name: "gap",
      packKey: null,
      config: { scenarioKeys: ["recipient-substitution"], variants: ["unpinned-recipient"], repetitions: 1 },
      seed: 5,
    });
    await waitFor(
      async () =>
        (
          (await managementQuery(
            `select status from public.validation_campaigns where id = '${campaignId}';`,
          )) as Array<{ status: string }>
        )[0].status === "completed",
    );

    const findings = (await managementQuery(
      `select f.id, f.severity, f.cause, f.status, f.evidence from public.validation_findings f where f.campaign_id = '${campaignId}' order by created_at;`,
    )) as Array<{
      id: string;
      severity: string;
      cause: string;
      status: string;
      evidence: { classification: string };
    }>;
    expect(findings.length).toBeGreaterThanOrEqual(3);
    expect(findings.every((f) => f.cause === "wrong_resource")).toBe(true);
    const leaks = findings.filter((f) => f.evidence.classification === "false_negative");
    expect(leaks.length).toBeGreaterThanOrEqual(1);
    expect(leaks.every((f) => ["high", "critical"].includes(f.severity))).toBe(true);

    const rems = (await managementQuery(
      `select r.id, r.kind, r.status, r.proposal from public.validation_remediations r join public.validation_findings f on f.id = r.finding_id where f.campaign_id = '${campaignId}';`,
    )) as Array<{
      id: string;
      kind: string;
      status: string;
      proposal: {
        broadensAuthority: boolean;
        requiresHumanReview: boolean;
        patch: { contractTransforms: Array<{ op: string; key: string; equals: string }> } | null;
      };
    }>;
    const pin = rems.find((r) => r.kind === "narrow_resource_binding")!;
    expect(pin.proposal.patch?.contractTransforms[0]).toMatchObject({
      op: "add_constraint",
      key: "to",
      equals: "maya@example.com",
    });
    expect(
      rems.every(
        (r) =>
          r.proposal.broadensAuthority === false &&
          r.proposal.requiresHumanReview === true &&
          r.status === "proposed",
      ),
    ).toBe(true);

    // The database refuses a proposal that claims it broadens authority.
    await expect(
      managementQuery(
        `update public.validation_remediations set proposal = proposal || '{"broadensAuthority": true}' where id = '${pin.id}';`,
      ),
    ).rejects.toThrow();

    // Human review: only security admin+; a developer or viewer cannot decide.
    const dev = await signInAs(DEV_EMAIL, TENANT_A_ID);
    expect(
      (
        await dev.supabase.rpc("decide_validation_remediation", {
          p_id: pin.id,
          p_decision: "accept",
          p_note: "",
        })
      ).error?.code,
    ).toBe("42501");
    const viewer = await signInAs(VIEWER_EMAIL, TENANT_A_ID);
    expect(
      (
        await viewer.supabase.rpc("decide_validation_remediation", {
          p_id: pin.id,
          p_decision: "accept",
          p_note: "",
        })
      ).error?.code,
    ).toBe("42501");
    const other = await signInAs(OWNER_B_EMAIL, TENANT_B_ID);
    expect(
      (
        await other.supabase.rpc("decide_validation_remediation", {
          p_id: pin.id,
          p_decision: "accept",
          p_note: "",
        })
      ).error?.code,
    ).toBe("P0002");

    // Nothing was applied to any real contract while the proposal was open.
    const before = (await managementQuery(
      `select count(*)::int as n from public.task_authority_contracts where tenant_id = '${TENANT_A_ID}' and demo_key like 'validation:%';`,
    )) as Array<{ n: number }>;
    expect(before[0].n).toBe(0);

    const owner = await signInAs(OWNER_A_EMAIL, TENANT_A_ID);
    expect(
      (
        await owner.supabase.rpc("decide_validation_remediation", {
          p_id: pin.id,
          p_decision: "accept",
          p_note: "pin it",
        })
      ).data,
    ).toBe("accepted");
    const started = await verifyAcceptedRemediation(owner.supabase, {
      tenantId: TENANT_A_ID,
      userId: "a0000000-0000-4000-8000-000000000001",
      remediationId: pin.id,
    });
    expect(started.regressionKey).toMatch(/^regression\.recipient-substitution\./);

    const verified = await waitFor(async () => {
      const [r] = (await managementQuery(
        `select status, verification, before_run_id, after_run_id from public.validation_remediations where id = '${pin.id}';`,
      )) as Array<{
        status: string;
        verification: { after: { verdict: string } };
        before_run_id: string;
        after_run_id: string;
      }>;
      return r.status === "verified" || r.status === "failed_verification" ? r : null;
    });
    expect(verified.status).toBe("verified");
    expect(verified.verification.after.verdict).toBe("pass");
    expect(verified.before_run_id).toBeTruthy();
    expect(verified.after_run_id).toBeTruthy();

    // A regression test now exists, is immutable, and passes.
    const [reg] = (await managementQuery(
      `select scenario_key, last_status from public.validation_regressions where tenant_id = '${TENANT_A_ID}' and scenario_key = '${started.regressionKey}';`,
    )) as Array<{ scenario_key: string; last_status: string }>;
    expect(reg).toMatchObject({ scenario_key: started.regressionKey, last_status: "pass" });
    await expect(
      managementQuery(
        `update public.validation_scenario_versions set definition = '{}' where scenario_key = '${started.regressionKey}';`,
      ),
    ).rejects.toThrow();
    expect(await sandboxCount()).toBe(0);
  }, 240_000);

  it("enforces environment limits, cancellation and sandbox cleanup", async () => {
    // run-count limit
    const limited = environmentSpecSchema.parse({ schemaVersion: 1, limits: { maxRuns: 2 } });
    const report = await runCampaign({
      config: {
        scenarioKeys: SCENARIOS.slice(0, 6).map((s) => s.key),
        variants: ["baseline"],
        repetitions: 1,
      },
      spec: limited,
      seed: 1,
      persist: null,
      ownerTenantId: null,
      actorUserId: null,
    });
    expect(report.runs).toHaveLength(2);
    expect(report.truncated).toBe(true);

    // campaign time limit
    const tiny = environmentSpecSchema.parse({ schemaVersion: 1, limits: { maxCampaignMs: 5000 } });
    const expired = await runCampaign({
      config: { scenarioKeys: SCENARIOS.map((s) => s.key), variants: ["baseline"], repetitions: 1 },
      spec: tiny,
      seed: 1,
      persist: null,
      ownerTenantId: null,
      actorUserId: null,
      concurrency: 1,
    });
    expect(expired.status).toBe("expired");
    expect(expired.runs.length).toBeLessThan(SCENARIOS.length);

    // cancellation through the database flag
    const id = await startCampaign({
      tenantId: TENANT_A_ID,
      userId: ADMIN_A,
      environmentId: envId,
      environmentSpec: spec,
      name: "cancel me",
      packKey: null,
      config: { scenarioKeys: SCENARIOS.map((s) => s.key), variants: ["baseline"], repetitions: 2 },
      seed: 9,
    });
    await new Promise((r) => setTimeout(r, 2500));
    expect(await vl.cancelCampaignRecord(TENANT_A_ID, ADMIN_A, id)).toBe("ok");
    const done = await waitFor(async () => {
      const [c] = (await managementQuery(
        `select status, progress from public.validation_campaigns where id = '${id}';`,
      )) as Array<{ status: string; progress: { done: number; total: number } }>;
      return c.status !== "running" && c.status !== "queued" ? c : null;
    });
    expect(done.status).toBe("cancelled");
    expect(done.progress.done).toBeLessThan(done.progress.total);
    expect(await sandboxCount()).toBe(0);
    expect(await vl.cancelCampaignRecord(TENANT_A_ID, ADMIN_A, id)).toBe("not_active");
  }, 300_000);

  it("expires abandoned sandboxes and enforces role, tenant and quota rules", async () => {
    const stale = await vl.createSandbox({ ownerTenantId: TENANT_A_ID, actorUserId: ADMIN_A, ttlMinutes: 1 });
    await managementQuery(
      `update public.tenants set validation_expires_at = now() - interval '1 minute' where id = '${stale}';`,
    );
    await expect(vl.seedSandbox(stale, { agents: [{ key: "primary" }], contract: {} })).rejects.toMatchObject(
      { sqlstate: "42501" },
    ); // expired sandboxes are unusable
    const swept = await vl.sweepValidation(50);
    expect(swept.sandboxes).toBeGreaterThanOrEqual(1);
    expect(await sandboxCount()).toBe(0);

    // a viewer cannot create sandboxes or environments; another tenant's member cannot use this tenant
    await expect(
      vl.createSandbox({
        ownerTenantId: TENANT_A_ID,
        actorUserId: "a0000000-0000-4000-8000-000000000004",
        ttlMinutes: 5,
      }),
    ).rejects.toMatchObject({ sqlstate: "42501" });
    await expect(
      createEnvironment({
        tenantId: TENANT_A_ID,
        userId: "b0000000-0000-4000-8000-000000000001",
        name: "x",
        description: null,
        ttlHours: 1,
      }),
    ).rejects.toMatchObject({ sqlstate: "42501" });
    await expect(
      vl.createSandbox({ ownerTenantId: TENANT_A_ID, actorUserId: ADMIN_A, ttlMinutes: 9999 }),
    ).rejects.toMatchObject({ sqlstate: "22023" });
    // an expired environment cannot start a campaign
    const old = await createEnvironment({
      tenantId: TENANT_A_ID,
      userId: ADMIN_A,
      name: "old",
      description: null,
      ttlHours: 1,
    });
    await managementQuery(
      `update public.validation_environments set expires_at = now() - interval '1 hour' where id = '${old}';`,
    );
    await expect(
      startCampaign({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A,
        environmentId: old,
        environmentSpec: spec,
        name: "x",
        packKey: null,
        config: { scenarioKeys: ["capability-theft"], variants: ["baseline"], repetitions: 1 },
        seed: 1,
      }),
    ).rejects.toMatchObject({ sqlstate: "55000" });
  }, 120_000);

  it("isolates campaign records by tenant and makes them read-only to clients", async () => {
    const other = await signInAs(OWNER_B_EMAIL, TENANT_B_ID);
    for (const t of [
      "validation_environments",
      "validation_campaigns",
      "validation_runs",
      "validation_steps",
      "validation_findings",
      "validation_remediations",
      "validation_regressions",
      "validation_scenario_versions",
    ] as const) {
      const r = await other.supabase.from(t).select("id");
      expect(r.data ?? [], t).toHaveLength(0);
    }
    const owner = await signInAs(OWNER_A_EMAIL, TENANT_A_ID);
    const ins = await owner.supabase.from("validation_findings").insert({ tenant_id: TENANT_A_ID } as never);
    expect(ins.error?.code).toBe("42501");
    const upd = await owner.supabase
      .from("validation_campaigns")
      .update({ status: "completed" })
      .eq("tenant_id", TENANT_A_ID);
    expect(upd.error?.code).toBe("42501");
    void gatewayQuery;
  }, 60_000);
});
