import "server-only";

import { breakerFor, type CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import type { RepositoryContext } from "@/lib/persistence/context";
import { safeLog } from "@/lib/semantic/scrub";

import {
  planSummaries,
  runJevContractPipeline,
  type JevContractPipelineResult,
  type NecessityMode,
} from "./contract-pipeline";
import type { JevContractPipelineOptions } from "./contract-pipeline";
import { canonicalHash } from "@/lib/authorization/canonicalize";
import { getJevSettings, recordCompletenessEvaluation, recordNecessityEvaluation } from "./persistence";
import { OpenRouterJevNecessityProvider } from "./openrouter-necessity-provider";
import { OpenRouterJevCompletenessProvider } from "./openrouter-completeness-provider";
import { runCompletenessEvaluation, type CompletenessRunResult } from "./completeness-runner";
import { getOpenRouterEnv } from "@/lib/openrouter/env";
import { JevProviderUnavailableError } from "./types";
import type { JevNecessityProvider } from "./necessity-provider";
import type { JevCompletenessProvider } from "./completeness-provider";
import type { CandidatePlan, Policy } from "@/lib/domain";

/** null when Jev necessity is not configured at all — callers then run the pipeline with `provider: null`, which forces effective mode "off" regardless of the tenant setting. */
export function loadNecessityProvider(): JevNecessityProvider | null {
  if (!getOpenRouterEnv()?.jevDecisionModel) return null;
  try {
    return new OpenRouterJevNecessityProvider();
  } catch (error) {
    if (error instanceof JevProviderUnavailableError) return null;
    throw error;
  }
}

/** null when Jev is not configured — mirrors `loadNecessityProvider`. There is no separate tenant setting for completeness; it shares `jev_settings.necessity_mode`'s off/shadow/enforce gate (see docs/jev/OVERVIEW.md) but never itself narrows or adds anything regardless of mode. */
export function loadCompletenessProvider(): JevCompletenessProvider | null {
  if (!getOpenRouterEnv()?.jevDecisionModel) return null;
  try {
    return new OpenRouterJevCompletenessProvider();
  } catch (error) {
    if (error instanceof JevProviderUnavailableError) return null;
    throw error;
  }
}

export interface RunAndRecordInput extends Omit<JevContractPipelineOptions, "mode" | "provider"> {
  context: RepositoryContext;
  tenantId: string;
}

/** Reads the tenant's own necessity setting, runs the pipeline, and returns it — persistence happens separately, once a plan id exists (see `persistNecessityRecords`). */
export async function loadModeAndRunPipeline(
  input: RunAndRecordInput,
): Promise<{ mode: NecessityMode; result: JevContractPipelineResult }> {
  const settings = await getJevSettings(input.context, input.tenantId).catch((error: unknown) => {
    safeLog(`jev: could not read settings (${error instanceof Error ? error.name : "unknown"})`);
    return { necessityMode: "off" as NecessityMode, riskMode: "off" as const };
  });
  const provider = settings.necessityMode === "off" ? null : loadNecessityProvider();
  const result = await runJevContractPipeline({
    ...input,
    mode: settings.necessityMode,
    provider,
    breaker: provider ? breakerFor(`jev-necessity:${provider.model}`) : undefined,
  });
  return { mode: settings.necessityMode, result };
}

export interface CompletenessCheckInput {
  context: RepositoryContext;
  tenantId: string;
  taskId: string;
  taskIntent: string;
  candidatePlan: CandidatePlan;
  registry: JevContractPipelineOptions["registry"];
  activePolicies: readonly Policy[];
  breaker?: CircuitBreaker;
  timeoutMs?: number;
}

/**
 * Plan-level completeness (role B extension — see docs/jev/OVERVIEW.md). Runs once per proposal, gated by the same
 * `jev_settings.necessity_mode` off/shadow/enforce setting as per-tool necessity (there is no separate column for
 * it), but its result is ALWAYS advisory only: this never adds, removes or reorders a plan node regardless of mode —
 * the caller only ever surfaces `possibleMissingOperationIds` for a human to look at.
 */
export async function checkPlanCompleteness(
  input: CompletenessCheckInput,
): Promise<{ mode: NecessityMode; run: CompletenessRunResult | null; inputHash: string | null }> {
  const settings = await getJevSettings(input.context, input.tenantId).catch((error: unknown) => {
    safeLog(`jev: could not read settings (${error instanceof Error ? error.name : "unknown"})`);
    return { necessityMode: "off" as NecessityMode, riskMode: "off" as const, enforcementApproved: false };
  });
  if (settings.necessityMode === "off") return { mode: "off", run: null, inputHash: null };
  const provider = loadCompletenessProvider();
  if (!provider) return { mode: settings.necessityMode, run: null, inputHash: null };

  const plan = input.candidatePlan;
  const usedProviders = new Set(
    plan.nodes
      .map((n) => input.registry.operations.get(n.tool)?.provider)
      .filter((p): p is string => p !== undefined),
  );
  const usedTools = new Set(plan.nodes.map((n) => n.tool));
  const candidateOperationIds = [...input.registry.operations.values()]
    .filter((op) => usedProviders.has(op.provider) && !usedTools.has(op.id))
    .map((op) => op.id)
    .sort();

  const completenessInput = {
    taskIntent: input.taskIntent,
    plan: planSummaries(plan),
    candidateOperationIds,
    activePolicySummaries: input.activePolicies.map((p) => `${p.effect}: ${p.name}`),
  };
  const inputHash = canonicalHash(completenessInput);
  const run = await runCompletenessEvaluation({
    provider,
    breaker: input.breaker ?? breakerFor(`jev-completeness:${provider.model}`),
    timeoutMs: input.timeoutMs,
    input: completenessInput,
  });
  return { mode: settings.necessityMode, run, inputHash };
}

/** Best-effort: an audit-trail write failing must never block contract proposal itself. */
export async function persistCompletenessCheck(
  context: RepositoryContext,
  input: { tenantId: string; taskId: string; planId: string; run: CompletenessRunResult; inputHash: string },
): Promise<void> {
  try {
    await recordCompletenessEvaluation(context, {
      tenantId: input.tenantId,
      taskId: input.taskId,
      planId: input.planId,
      run: input.run,
      inputHash: input.inputHash,
    });
  } catch (error) {
    safeLog(
      `jev: failed to record completeness evaluation (${error instanceof Error ? error.name : "unknown"})`,
    );
  }
}

/** Best-effort: an audit-trail write failing must never block contract proposal itself. */
export async function persistNecessityRecords(
  context: RepositoryContext,
  input: {
    tenantId: string;
    taskId: string;
    planId: string;
    registryVersion: string;
    compilerVersion: string;
    mode: NecessityMode;
    result: JevContractPipelineResult;
  },
): Promise<void> {
  if (input.mode === "off") return;
  for (const record of input.result.nodeRecords) {
    if (!record.necessityRun || !record.inputHash) continue;
    try {
      await recordNecessityEvaluation(context, {
        tenantId: input.tenantId,
        taskId: input.taskId,
        planId: input.planId,
        nodeKey: record.nodeId,
        tool: record.tool,
        registryVersion: input.registryVersion,
        compilerVersion: input.compilerVersion,
        mode: input.mode as Extract<NecessityMode, "shadow" | "enforce">,
        run: record.necessityRun,
        inputHash: record.inputHash,
        mechanicalStatus: record.mechanicalStatus,
        finalStatus: record.finalStatus,
        disagreement: record.disagreement,
      });
    } catch (error) {
      safeLog(
        `jev: failed to record necessity evaluation (${error instanceof Error ? error.name : "unknown"})`,
      );
    }
  }
}
