import type { CircuitBreaker } from "@/lib/semantic/circuit-breaker";

import type { JevNecessityProvider, NecessityEvaluationInput } from "./necessity-provider";
import { JevProviderError, JevProviderUnavailableError, type ToolNecessityEvaluation } from "./types";

export const DEFAULT_NECESSITY_TIMEOUT_MS = 15_000;

export type NecessityRunState = "ok" | "unavailable" | "timeout" | "error" | "circuit_open";

export interface NecessityRunResult {
  state: NecessityRunState;
  /** null exactly when state !== "ok" — see the combination rules in contract-pipeline.ts: a non-"ok" result is never treated as approved. */
  evaluation: ToolNecessityEvaluation | null;
  latencyMs: number;
  errorCategory: string | null;
  provider: string;
  model: string;
  modelVersion: string;
}

export interface RunNecessityEvaluationOptions {
  provider: JevNecessityProvider;
  input: NecessityEvaluationInput;
  timeoutMs?: number;
  breaker?: CircuitBreaker;
  clock?: () => number;
}

/**
 * Runs one necessity evaluation end to end and *always resolves* — mirrors `semantic/runner.ts`'s fixed order
 * (breaker gate → provider call under a deadline → typed result), extended for Jev's own typed decision shape rather
 * than the semantic evidence schema. Every failure mode becomes a non-"ok" state with `evaluation: null`; the
 * contract pipeline's combination rules require that a null evaluation is never treated as an approval.
 */
export async function runNecessityEvaluation(
  options: RunNecessityEvaluationOptions,
): Promise<NecessityRunResult> {
  const { provider, breaker } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_NECESSITY_TIMEOUT_MS;
  const clock = options.clock ?? (() => performance.now());
  const identity = { provider: provider.name, model: provider.model, modelVersion: provider.modelVersion };

  const degraded = (
    state: NecessityRunState,
    latencyMs: number,
    errorCategory: string,
  ): NecessityRunResult => ({
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

  let evaluation: ToolNecessityEvaluation;
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
