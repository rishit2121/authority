import type { CircuitBreaker } from "@/lib/semantic/circuit-breaker";

import type { CompletenessEvaluationInput, JevCompletenessProvider } from "./completeness-provider";
import { JevProviderError, JevProviderUnavailableError, type PlanCompletenessEvaluation } from "./types";

export const DEFAULT_COMPLETENESS_TIMEOUT_MS = 15_000;

export type CompletenessRunState = "ok" | "unavailable" | "timeout" | "error" | "circuit_open";

export interface CompletenessRunResult {
  state: CompletenessRunState;
  /** null exactly when state !== "ok" — a non-"ok" result never suggests anything is missing, it is simply absent. */
  evaluation: PlanCompletenessEvaluation | null;
  latencyMs: number;
  errorCategory: string | null;
  provider: string;
  model: string;
  modelVersion: string;
}

export interface RunCompletenessEvaluationOptions {
  provider: JevCompletenessProvider;
  input: CompletenessEvaluationInput;
  timeoutMs?: number;
  breaker?: CircuitBreaker;
  clock?: () => number;
}

/** One plan-level completeness evaluation, always resolves — mirrors `necessity-runner.ts`'s fixed order exactly (breaker gate → provider call under a deadline → typed result). */
export async function runCompletenessEvaluation(
  options: RunCompletenessEvaluationOptions,
): Promise<CompletenessRunResult> {
  const { provider, breaker } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMPLETENESS_TIMEOUT_MS;
  const clock = options.clock ?? (() => performance.now());
  const identity = { provider: provider.name, model: provider.model, modelVersion: provider.modelVersion };

  const degraded = (
    state: CompletenessRunState,
    latencyMs: number,
    errorCategory: string,
  ): CompletenessRunResult => ({
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

  let evaluation: PlanCompletenessEvaluation;
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
