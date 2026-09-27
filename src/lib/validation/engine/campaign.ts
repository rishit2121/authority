import "server-only";

import { safeLog } from "@/lib/semantic/scrub";

import { buildFindings } from "../findings";
import { CATEGORY_COUNT, SCENARIO_BY_KEY, scenarioHash } from "../library";
import { aggregateMetrics, type CampaignMetrics } from "../metrics";
import type { EffectiveContract } from "../remediation";
import {
  scenarioSchema,
  type CampaignConfig,
  type ConfigPatch,
  type EnvironmentSpec,
  type FindingDraft,
  type RunResult,
  type Scenario,
  type StepResult,
} from "../schema";
import * as vl from "./db";
import { ScenarioAuthoringError } from "./compile";
import { runScenario } from "./runner";

/**
 * Deterministic campaign engine: expands (scenarios x variants x repetitions), runs them with bounded concurrency in
 * isolated sandboxes, records progress as it goes (so the UI animates real persisted events), enforces the hard
 * limits (steps, per-scenario time, campaign time, run count), honors cancellation, and always cleans up.
 */

export interface CampaignInput {
  config: CampaignConfig;
  spec: EnvironmentSpec;
  seed: number;
  /** Persist records for this tenant/campaign; `null` = ephemeral (CLI, tests). */
  persist: { tenantId: string; campaignId: string } | null;
  ownerTenantId: string | null;
  actorUserId: string | null;
  concurrency?: number;
  signal?: AbortSignal;
  /** Extra/custom scenario definitions (e.g. loaded regression tests) by key. */
  extraScenarios?: Scenario[];
  onProgress?: (p: { total: number; done: number; current: string | null }) => void;
  onRun?: (r: PlannedRunResult) => void;
}

export interface PlannedRunResult {
  scenario: Scenario;
  result: RunResult;
  effective: EffectiveContract;
  findings: FindingDraft[];
  runId: string | null;
  scenarioVersionId: string | null;
  regressionId: string | null;
}

export interface CampaignReport {
  status: "completed" | "cancelled" | "expired" | "failed";
  seed: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  runs: PlannedRunResult[];
  findings: FindingDraft[];
  metrics: CampaignMetrics;
  truncated: boolean;
  notes: string[];
}

interface PlannedRun {
  scenario: Scenario;
  variant: string;
  repetition: number;
  scenarioVersionId: string | null;
  regressionId: string | null;
}

/** Removes anything that could carry raw argument values before a step is stored. */
export function stripForStorage(step: StepResult): Record<string, unknown> {
  const request = step.request ? { ...step.request } : null;
  if (request) delete (request as Record<string, unknown>).argumentValues;
  return {
    seq: step.seq,
    stepKey: step.stepKey,
    kind: step.kind,
    action: step.action,
    label: step.label,
    request,
    expected: step.expected,
    actual: step.actual,
    verdict: step.verdict,
    control: step.control,
    latencyMs: step.latencyMs,
    evidence: step.evidence,
    occurredAt: step.occurredAt,
  };
}

export async function runCampaign(input: CampaignInput): Promise<CampaignReport> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const limits = input.spec.limits;
  const notes: string[] = [];
  const persist = input.persist;

  // ---- resolve scenarios (built-in library, supplied definitions, stored regression versions) -------------------
  const byKey = new Map<
    string,
    { scenario: Scenario; versionId: string | null; regressionId: string | null }
  >();
  for (const key of input.config.scenarioKeys) {
    const supplied = input.extraScenarios?.find((s) => s.key === key);
    const builtin = SCENARIO_BY_KEY.get(key);
    if (supplied) byKey.set(key, { scenario: supplied, versionId: null, regressionId: null });
    else if (builtin) byKey.set(key, { scenario: builtin, versionId: null, regressionId: null });
  }
  if (persist) {
    const missing = input.config.scenarioKeys.filter((k) => !byKey.has(k));
    for (const stored of await vl.loadStoredScenarios(persist.tenantId, missing)) {
      const parsed = scenarioSchema.safeParse(stored.definition);
      if (parsed.success)
        byKey.set(stored.key, {
          scenario: parsed.data,
          versionId: stored.id,
          regressionId: stored.regressionId,
        });
    }
    for (const [key, entry] of byKey) {
      if (entry.versionId) continue;
      entry.versionId = await vl.registerScenario({
        tenantId: persist.tenantId,
        key,
        version: entry.scenario.version,
        source: entry.scenario.key.startsWith("regression.") ? "regression" : "builtin",
        definition: entry.scenario,
        hash: scenarioHash(entry.scenario),
      });
    }
  }
  const unknown = input.config.scenarioKeys.filter((k) => !byKey.has(k));
  if (unknown.length > 0) notes.push(`Unknown scenario(s) skipped: ${unknown.join(", ")}`);

  // ---- expand the run plan --------------------------------------------------------------------------------------
  const plan: PlannedRun[] = [];
  for (const [, entry] of byKey) {
    for (const variant of input.config.variants) {
      if (variant !== "baseline" && !entry.scenario.variants.some((v) => v.label === variant)) continue;
      for (let r = 1; r <= input.config.repetitions; r++)
        plan.push({
          scenario: entry.scenario,
          variant,
          repetition: r,
          scenarioVersionId: entry.versionId,
          regressionId: entry.regressionId,
        });
    }
  }
  let truncated = false;
  if (plan.length > limits.maxRuns) {
    plan.length = limits.maxRuns;
    truncated = true;
    notes.push(`Run count limited to ${limits.maxRuns}.`);
  }

  if (persist)
    await vl.setCampaign({
      tenantId: persist.tenantId,
      campaignId: persist.campaignId,
      status: "running",
      progress: { total: plan.length, done: 0, current: null },
    });

  const controller = new AbortController();
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const results: PlannedRunResult[] = [];
  let done = 0;
  let cursor = 0;
  let expired = false;

  const shouldStop = async (): Promise<boolean> => {
    if (controller.signal.aborted) return true;
    if (Date.now() - started > limits.maxCampaignMs) {
      expired = true;
      controller.abort();
      return true;
    }
    if (persist) {
      const c = await vl.campaignControl(persist.tenantId, persist.campaignId).catch(() => null);
      if (c?.cancel) {
        controller.abort();
        return true;
      }
    }
    return false;
  };

  const worker = async () => {
    for (;;) {
      if (await shouldStop()) return;
      const idx = cursor++;
      if (idx >= plan.length) return;
      const p = plan[idx];
      let runId: string | null = null;
      try {
        const seedForRun = input.seed;
        if (persist && p.scenarioVersionId) {
          runId = await vl.recordRun(persist.tenantId, persist.campaignId, {
            scenarioVersionId: p.scenarioVersionId,
            scenarioKey: p.scenario.key,
            scenarioVersion: p.scenario.version,
            variant: p.variant,
            repetition: p.repetition,
            seed: seedForRun,
            status: "running",
            regressionId: p.regressionId,
          });
        }
        const pending: StepResult[] = [];
        const outcome = await runScenario({
          scenario: p.scenario,
          variant: p.variant,
          seed: seedForRun,
          repetition: p.repetition,
          ownerTenantId: input.ownerTenantId,
          actorUserId: input.actorUserId,
          limits,
          sandboxMinutes: input.spec.sandboxMinutes,
          signal: controller.signal,
          onStep: async (s) => {
            pending.push(s);
            if (persist && runId)
              await vl.recordSteps(persist.tenantId, runId, [stripForStorage(s)]).catch(() => undefined);
          },
        });
        const findings = buildFindings(outcome.resolved, outcome.result, outcome.effective);
        if (persist && runId) {
          await vl.recordRun(persist.tenantId, persist.campaignId, {
            id: runId,
            scenarioVersionId: p.scenarioVersionId,
            scenarioKey: p.scenario.key,
            scenarioVersion: p.scenario.version,
            variant: p.variant,
            repetition: p.repetition,
            seed: seedForRun,
            status: outcome.result.status,
            verdict: outcome.result.verdict,
            regressionId: p.regressionId,
            metrics: outcome.result.metrics,
            effects: outcome.result.effects.map((e) => ({
              tool: e.tool,
              stepKey: e.stepKey,
              description: e.description,
              violates: e.violates,
            })),
            errorCategory: outcome.result.errorCategory,
          });
          if (findings.length > 0)
            await vl
              .recordFindings(persist.tenantId, persist.campaignId, runId, findings)
              .catch(() => undefined);
          if (p.regressionId && outcome.result.verdict !== "error")
            await vl
              .updateRegressionResult(persist.tenantId, p.regressionId, runId, outcome.result.verdict)
              .catch(() => undefined);
        }
        const planned: PlannedRunResult = {
          scenario: outcome.resolved,
          result: outcome.result,
          effective: outcome.effective,
          findings,
          runId,
          scenarioVersionId: p.scenarioVersionId,
          regressionId: p.regressionId,
        };
        results.push(planned);
        input.onRun?.(planned);
      } catch (error) {
        if (error instanceof ScenarioAuthoringError) notes.push(`${p.scenario.key}: ${error.message}`);
        else safeLog(`validation: run failed (${error instanceof Error ? error.name : "unknown"})`);
        if (persist && runId)
          await vl
            .recordRun(persist.tenantId, persist.campaignId, {
              id: runId,
              scenarioVersionId: p.scenarioVersionId,
              scenarioKey: p.scenario.key,
              scenarioVersion: p.scenario.version,
              variant: p.variant,
              repetition: p.repetition,
              seed: input.seed,
              status: "error",
              verdict: "error",
              errorCategory: "engine",
            })
            .catch(() => undefined);
      }
      done += 1;
      input.onProgress?.({ total: plan.length, done, current: p.scenario.key });
      if (persist)
        await vl
          .setCampaign({
            tenantId: persist.tenantId,
            campaignId: persist.campaignId,
            progress: { total: plan.length, done, current: p.scenario.key },
          })
          .catch(() => undefined);
    }
  };

  const concurrency = Math.max(1, Math.min(input.concurrency ?? 3, 4));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const cancelled = controller.signal.aborted && !expired;
  const status: CampaignReport["status"] = expired ? "expired" : cancelled ? "cancelled" : "completed";
  const metrics = aggregateMetrics(
    results.map((r) => r.result),
    CATEGORY_COUNT,
  );
  const findings = results.flatMap((r) => r.findings);
  const finishedAt = new Date().toISOString();

  if (persist) {
    await vl.setCampaign({
      tenantId: persist.tenantId,
      campaignId: persist.campaignId,
      status,
      progress: { total: plan.length, done, current: null },
      summary: {
        synthetic: true,
        metrics,
        findings: findings.length,
        runs: results.map((r) => ({
          key: r.result.scenarioKey,
          variant: r.result.variant,
          verdict: r.result.verdict,
        })),
        truncated,
        notes,
        durationMs: Date.now() - started,
      },
    });
  }
  return {
    status,
    seed: input.seed,
    startedAt,
    finishedAt,
    durationMs: Date.now() - started,
    runs: results,
    findings,
    metrics,
    truncated,
    notes,
  };
}

export type { ConfigPatch };
