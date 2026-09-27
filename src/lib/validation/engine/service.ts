import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { safeLog } from "@/lib/semantic/scrub";
import type { Database } from "@/lib/supabase/database.types";

import { SCENARIO_BY_KEY, scenarioHash } from "../library";
import { buildRegressionScenario } from "../regression";
import {
  campaignConfigSchema,
  environmentSpecSchema,
  remediationProposalSchema,
  scenarioSchema,
  type CampaignConfig,
  type EnvironmentSpec,
} from "../schema";
import { runCampaign } from "./campaign";
import * as vl from "./db";

/**
 * Server-side orchestration used by the UI's server actions and the maintenance job. Campaigns run in the background of
 * the long-lived Node server (Render); progress and results are persisted as they happen, so a page reload or another
 * device sees the same state. A run that outlives its process is failed by the maintenance sweep.
 */

const controllers = new Map<string, AbortController>();

export async function createEnvironment(input: {
  tenantId: string;
  userId: string;
  name: string;
  description: string | null;
  ttlHours: number;
  spec?: unknown;
}): Promise<string> {
  const spec = environmentSpecSchema.parse(input.spec ?? { schemaVersion: 1 });
  return vl.createEnvironment({
    tenantId: input.tenantId,
    userId: input.userId,
    name: input.name,
    description: input.description,
    spec,
    ttlHours: input.ttlHours,
  });
}

export async function startCampaign(input: {
  tenantId: string;
  userId: string;
  environmentId: string;
  environmentSpec: EnvironmentSpec;
  name: string;
  packKey: string | null;
  config: CampaignConfig;
  seed: number;
  onFinished?: (r: Awaited<ReturnType<typeof runCampaign>>, campaignId: string) => Promise<void>;
}): Promise<string> {
  const config = campaignConfigSchema.parse(input.config);
  const total = config.scenarioKeys.length * config.variants.length * config.repetitions;
  const campaignId = await vl.startCampaignRecord({
    tenantId: input.tenantId,
    userId: input.userId,
    environmentId: input.environmentId,
    name: input.name,
    packKey: input.packKey,
    seed: input.seed,
    config,
    total: Math.min(total, input.environmentSpec.limits.maxRuns),
  });
  const controller = new AbortController();
  controllers.set(campaignId, controller);
  void (async () => {
    try {
      const report = await runCampaign({
        config,
        spec: input.environmentSpec,
        seed: input.seed,
        persist: { tenantId: input.tenantId, campaignId },
        ownerTenantId: input.tenantId,
        actorUserId: input.userId,
        signal: controller.signal,
      });
      await input.onFinished?.(report, campaignId);
    } catch (error) {
      safeLog(`validation: campaign failed (${error instanceof Error ? error.name : "unknown"})`);
      await vl
        .setCampaign({
          tenantId: input.tenantId,
          campaignId,
          status: "failed",
          summary: { error: "campaign failed" },
        })
        .catch(() => undefined);
    } finally {
      controllers.delete(campaignId);
    }
  })();
  return campaignId;
}

export async function cancelCampaign(tenantId: string, userId: string, campaignId: string): Promise<string> {
  const status = await vl.cancelCampaignRecord(tenantId, userId, campaignId);
  controllers.get(campaignId)?.abort();
  return status;
}

type Db = SupabaseClient<Database>;

/**
 * After a human ACCEPTED a remediation: pin the regression scenario (attack + the accepted fix), register it, then run it
 * as a verification campaign and record the before/after comparison. Nothing here touches a real contract or policy.
 */
export async function verifyAcceptedRemediation(
  db: Db,
  input: { tenantId: string; userId: string; remediationId: string },
): Promise<{ campaignId: string | null; regressionKey: string | null; error?: string }> {
  const { data: rem } = await db
    .from("validation_remediations")
    .select("id, finding_id, proposal, status")
    .eq("id", input.remediationId)
    .single();
  if (!rem || rem.status !== "accepted")
    return { campaignId: null, regressionKey: null, error: "remediation is not accepted" };
  const proposal = remediationProposalSchema.safeParse(rem.proposal);
  if (!proposal.success) return { campaignId: null, regressionKey: null, error: "invalid proposal" };
  const { data: finding } = await db
    .from("validation_findings")
    .select("id, run_id, campaign_id, scenario_key, evidence")
    .eq("id", rem.finding_id)
    .single();
  if (!finding) return { campaignId: null, regressionKey: null, error: "finding not found" };
  const { data: run } = await db
    .from("validation_runs")
    .select("id, scenario_version_id, variant, seed")
    .eq("id", finding.run_id)
    .single();
  const { data: campaign } = await db
    .from("validation_campaigns")
    .select("id, environment_id, seed")
    .eq("id", finding.campaign_id)
    .single();
  if (!run || !campaign) return { campaignId: null, regressionKey: null, error: "run not found" };
  const { data: sv } = await db
    .from("validation_scenario_versions")
    .select("definition")
    .eq("id", run.scenario_version_id)
    .single();
  const parsed = scenarioSchema.safeParse(sv?.definition);
  if (!parsed.success)
    return { campaignId: null, regressionKey: null, error: "scenario definition unavailable" };
  const { data: env } = await db
    .from("validation_environments")
    .select("spec")
    .eq("id", campaign.environment_id)
    .single();
  const spec = environmentSpecSchema.parse(env?.spec ?? { schemaVersion: 1 });

  const regression = buildRegressionScenario(parsed.data, run.variant, proposal.data, rem.id);
  const versionId = await vl.registerScenario({
    tenantId: input.tenantId,
    key: regression.key,
    version: regression.version,
    source: "regression",
    definition: regression,
    hash: scenarioHash(regression),
  });
  await vl.registerRegression({
    tenantId: input.tenantId,
    remediationId: rem.id,
    key: regression.key,
    scenarioVersionId: versionId,
    description: `Prevents recurrence of: ${finding.scenario_key} (${proposal.data.title})`,
  });

  const campaignId = await startCampaign({
    tenantId: input.tenantId,
    userId: input.userId,
    environmentId: campaign.environment_id,
    environmentSpec: spec,
    name: `Verification: ${proposal.data.title}`.slice(0, 160),
    packKey: null,
    config: { scenarioKeys: [regression.key], variants: ["baseline"], repetitions: 1 },
    seed: campaign.seed,
    onFinished: async (report, id) => {
      const after = report.runs[0];
      const passed = after?.result.verdict === "pass";
      await vl.recordVerification({
        tenantId: input.tenantId,
        remediationId: rem.id,
        beforeRunId: finding.run_id,
        afterRunId: after?.runId ?? null,
        status: passed ? "verified" : "failed",
        verification: {
          campaignId: id,
          before: { runId: finding.run_id, verdict: "fail", variant: run.variant },
          after: {
            runId: after?.runId,
            verdict: after?.result.verdict ?? "error",
            failingSteps: after?.result.steps.filter((s) => s.verdict !== "pass").map((s) => s.stepKey) ?? [],
          },
          synthetic: true,
        },
      });
    },
  });
  return { campaignId, regressionKey: regression.key };
}

export function builtinScenarioExists(key: string): boolean {
  return SCENARIO_BY_KEY.has(key);
}
