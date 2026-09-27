"use server";

import { revalidatePath } from "next/cache";

import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { safeLog } from "@/lib/semantic/scrub";
import {
  cancelCampaign,
  createEnvironment,
  startCampaign,
  verifyAcceptedRemediation,
} from "@/lib/validation/engine/service";
import { PACKS, SCENARIO_BY_KEY } from "@/lib/validation/library";
import { campaignConfigSchema, environmentSpecSchema } from "@/lib/validation/schema";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendly(error: unknown, fallback: string): string {
  const code = (error as { sqlstate?: string; code?: string } | null)?.sqlstate;
  if (code === "42501")
    return "Your role cannot do this. Developers and above can run campaigns; security admins decide remediations.";
  if (code === "55000") return "That environment has expired. Create a new one.";
  if (code === "54000" || code === "53400")
    return "A validation limit was reached. Wait for active campaigns to finish.";
  if (code === "22023") return "Invalid value.";
  return fallback;
}

export async function createEnvironmentAction(input: {
  name: string;
  ttlHours: number;
}): Promise<ActionResult<{ id: string }>> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) return { ok: false, error: "Name must be 1–120 characters." };
  const ttl = Math.max(1, Math.min(72, Math.floor(input.ttlHours)));
  try {
    const { identity } = await createRepositoriesForCurrentTenant("/app/validation");
    const id = await createEnvironment({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      name,
      description: null,
      ttlHours: ttl,
    });
    revalidatePath("/app/validation");
    return { ok: true, id };
  } catch (error) {
    safeLog("validation: createEnvironment failed");
    return { ok: false, error: friendly(error, "The environment could not be created.") };
  }
}

export interface StartCampaignInput {
  environmentId: string;
  name: string;
  packKey?: string | null;
  scenarioKeys?: string[];
  variants?: string[];
  repetitions?: number;
  seed?: number;
}

async function launch(
  input: StartCampaignInput,
  returnPath: string,
): Promise<ActionResult<{ campaignId: string }>> {
  if (!UUID.test(input.environmentId)) return { ok: false, error: "Choose an environment." };
  const pack = input.packKey ? PACKS.find((p) => p.key === input.packKey) : undefined;
  const scenarioKeys = (pack ? pack.scenarioKeys : (input.scenarioKeys ?? [])).filter(
    (k) => SCENARIO_BY_KEY.has(k) || k.startsWith("regression."),
  );
  if (scenarioKeys.length === 0) return { ok: false, error: "Select at least one scenario." };
  const parsed = campaignConfigSchema.safeParse({
    scenarioKeys,
    variants: pack ? pack.variants : (input.variants ?? ["baseline"]),
    repetitions: input.repetitions ?? 1,
  });
  if (!parsed.success) return { ok: false, error: "That campaign configuration is not valid." };
  const name = (input.name.trim() || pack?.title || "Validation campaign").slice(0, 160);
  const seed = Number.isSafeInteger(input.seed)
    ? (input.seed as number)
    : Math.floor(Math.random() * 1_000_000);

  try {
    const { identity, context } = await createRepositoriesForCurrentTenant(returnPath);
    const { data: env } = await context.supabase
      .from("validation_environments")
      .select("id, spec, expires_at")
      .eq("id", input.environmentId)
      .maybeSingle();
    if (!env) return { ok: false, error: "Environment not found." };
    if (Date.parse(env.expires_at) <= Date.now())
      return { ok: false, error: "That environment has expired. Create a new one." };
    const spec = environmentSpecSchema.parse(env.spec);
    const campaignId = await startCampaign({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      environmentId: env.id,
      environmentSpec: spec,
      name,
      packKey: pack?.key ?? null,
      config: parsed.data,
      seed,
    });
    revalidatePath("/app/validation");
    return { ok: true, campaignId };
  } catch (error) {
    safeLog("validation: startCampaign failed");
    return { ok: false, error: friendly(error, "The campaign could not be started.") };
  }
}

export async function startCampaignAction(
  input: StartCampaignInput,
): Promise<ActionResult<{ campaignId: string }>> {
  return launch(input, "/app/validation/campaigns/new");
}

/** Same scenarios, variants, repetitions and seed: a reproducible rerun (e.g. after a fix). */
export async function rerunCampaignAction(campaignId: string): Promise<ActionResult<{ campaignId: string }>> {
  if (!UUID.test(campaignId)) return { ok: false, error: "Invalid campaign." };
  const { context } = await createRepositoriesForCurrentTenant("/app/validation");
  const { data: c } = await context.supabase
    .from("validation_campaigns")
    .select("environment_id, name, config, seed, pack_key")
    .eq("id", campaignId)
    .maybeSingle();
  if (!c) return { ok: false, error: "Campaign not found." };
  const config = campaignConfigSchema.safeParse(c.config);
  if (!config.success) return { ok: false, error: "The original configuration can no longer be run." };
  return launch(
    {
      environmentId: c.environment_id,
      name: `Rerun: ${c.name}`.slice(0, 160),
      scenarioKeys: config.data.scenarioKeys,
      variants: config.data.variants,
      repetitions: config.data.repetitions,
      seed: Number(c.seed),
    },
    "/app/validation",
  );
}

export async function cancelCampaignAction(campaignId: string): Promise<ActionResult> {
  if (!UUID.test(campaignId)) return { ok: false, error: "Invalid campaign." };
  try {
    const { identity } = await createRepositoriesForCurrentTenant("/app/validation");
    const status = await cancelCampaign(identity.tenant.tenantId, identity.userId, campaignId);
    revalidatePath("/app/validation");
    return status === "ok" ? { ok: true } : { ok: false, error: "That campaign is not running." };
  } catch (error) {
    return { ok: false, error: friendly(error, "The campaign could not be cancelled.") };
  }
}

/**
 * A human decision. Accepting records intent and starts the regression + verification rerun; it does NOT change any
 * active contract or policy (applying a fix is a separate, explicit change made through the normal contract flow).
 */
export async function decideRemediationAction(
  remediationId: string,
  decision: "accept" | "reject",
  note: string,
): Promise<ActionResult<{ verificationCampaignId?: string | null; regressionKey?: string | null }>> {
  if (!UUID.test(remediationId)) return { ok: false, error: "Invalid remediation." };
  if (note.length > 1000) return { ok: false, error: "Notes are limited to 1000 characters." };
  try {
    const { identity, context } = await createRepositoriesForCurrentTenant("/app/validation/remediations");
    const { error } = await context.supabase.rpc("decide_validation_remediation", {
      p_id: remediationId,
      p_decision: decision,
      p_note: note.trim(),
    });
    if (error) {
      if (error.code === "42501")
        return { ok: false, error: "Only security admins and above can decide remediations." };
      if (error.code === "P0002") return { ok: false, error: "Remediation not found." };
      return { ok: false, error: "That decision could not be recorded (it may already be decided)." };
    }
    let verificationCampaignId: string | null = null;
    let regressionKey: string | null = null;
    if (decision === "accept") {
      const r = await verifyAcceptedRemediation(context.supabase, {
        tenantId: identity.tenant.tenantId,
        userId: identity.userId,
        remediationId,
      });
      verificationCampaignId = r.campaignId;
      regressionKey = r.regressionKey;
      if (r.error) safeLog("validation: verification did not start");
    }
    revalidatePath("/app/validation", "layout");
    return { ok: true, verificationCampaignId, regressionKey };
  } catch (error) {
    safeLog("validation: decideRemediation failed");
    return { ok: false, error: friendly(error, "The decision could not be recorded.") };
  }
}
