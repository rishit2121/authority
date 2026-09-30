import type { CircuitBreaker } from "@/lib/semantic/circuit-breaker";

import type { JevRiskProvider, RiskEvaluationInput } from "./risk-provider";
import { JevProviderError, JevProviderUnavailableError, type ToolRiskEvaluation } from "./types";

export const DEFAULT_RISK_TIMEOUT_MS = 800;
export type RiskRunState = "ok" | "unavailable" | "timeout" | "error" | "circuit_open";

export interface RiskRunResult {
  state: RiskRunState;
  evaluation: ToolRiskEvaluation | null;
  latencyMs: number;
  errorCategory: string | null;
  provider: string;
  model: string;
  modelVersion: string;
}

export interface RunRiskEvaluationOptions {
  provider: JevRiskProvider;
  input: RiskEvaluationInput;
  timeoutMs?: number;
  breaker?: CircuitBreaker;
  clock?: () => number;
}

/** Shadow-mode runner: always resolves, never throws, and its result never has write access to any decision (see `lib/gateway/pipeline.ts`). */
export async function runRiskEvaluation(options: RunRiskEvaluationOptions): Promise<RiskRunResult> {
  const { provider, breaker } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RISK_TIMEOUT_MS;
  const clock = options.clock ?? (() => performance.now());
  const identity = { provider: provider.name, model: provider.model, modelVersion: provider.modelVersion };

  const degraded = (state: RiskRunState, latencyMs: number, errorCategory: string): RiskRunResult => ({
    state,
    evaluation: null,
    latencyMs: Math.max(0, Math.round(latencyMs)),
    errorCategory,
    ...identity,
  });

  if (breaker && !breaker.tryAcquire()) return degraded("circuit_open", 0, "circuit_open");

  const controller = new AbortController();
  const started = clock();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let evaluation: ToolRiskEvaluation;
  try {
    evaluation = await Promise.race([
      provider.evaluate(options.input, { signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new JevProviderError("timeout", "deadline")),
        );
      }),
    ]);
  } catch (error) {
    const elapsed = clock() - started;
    if (error instanceof JevProviderUnavailableError) return degraded("unavailable", elapsed, "unavailable");
    breaker?.recordFailure();
    if (timedOut) return degraded("timeout", timeoutMs, "timeout");
    const category = error instanceof JevProviderError ? error.category : "provider_error";
    return degraded("error", elapsed, /^[a-z_]{1,40}$/.test(category) ? category : "provider_error");
  } finally {
    clearTimeout(timer);
  }
  breaker?.recordSuccess();

  return {
    state: "ok",
    evaluation,
    latencyMs: Math.max(0, Math.round(clock() - started)),
    errorCategory: null,
    ...identity,
  };
}
