import "server-only";

import { breakerFor } from "@/lib/semantic/circuit-breaker";
import type { RepositoryContext } from "@/lib/persistence/context";
import { safeLog } from "@/lib/semantic/scrub";

import {
  runJevContractPipeline,
  type JevContractPipelineResult,
  type NecessityMode,
} from "./contract-pipeline";
import type { JevContractPipelineOptions } from "./contract-pipeline";
import { getJevSettings, recordNecessityEvaluation } from "./persistence";
import { OpenRouterJevNecessityProvider } from "./openrouter-necessity-provider";
import { getOpenRouterEnv } from "@/lib/openrouter/env";
import { JevProviderUnavailableError } from "./types";
import type { JevNecessityProvider } from "./necessity-provider";

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
