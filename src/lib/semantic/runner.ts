import {
  providerSignalPayloadSchema,
  semanticEvidenceSchema,
  type SemanticEvidence,
  type SemanticEvidenceState,
  type SemanticRiskInput,
} from "@/lib/domain";

import type { CircuitBreaker } from "./circuit-breaker";
import {
  SemanticProviderError,
  SemanticProviderUnavailableError,
  type SemanticRiskProvider,
} from "./provider";
import {
  DEFAULT_REDACTION_LIMITS,
  hashRedactedInput,
  redactSemanticInput,
  type RedactableInput,
  type RedactionLimits,
} from "./redaction";
import { riskLevelFor } from "./risk";

export const DEFAULT_SEMANTIC_TIMEOUT_MS = 800;
/** Hard ceiling on a provider response body we are willing to parse. */
export const MAX_PROVIDER_RESPONSE_CHARS = 16_000;

export interface RunSemanticEvaluationOptions {
  provider: SemanticRiskProvider;
  input: RedactableInput;
  timeoutMs?: number;
  breaker?: CircuitBreaker;
  redactionLimits?: RedactionLimits;
  now?: () => Date;
  clock?: () => number;
}

export interface SemanticRunResult {
  evidence: SemanticEvidence;
  /** The redacted payload the provider was (or would have been) sent — for tests; never persisted. */
  redactedInput: SemanticRiskInput;
}

/**
 * Runs one shadow evaluation end to end and *always resolves* with evidence.
 *
 * Order matters and is fixed: redact → breaker gate → provider call under a
 * deadline → strict schema validation → risk derivation. Every failure mode
 * (unconfigured, breaker open, timeout, network/HTTP error, malformed or
 * oversized output, extra fields, out-of-range numbers) becomes a degraded
 * evidence record with `signals: null` and `riskLevel: "unknown"` — never an
 * exception, and never neutral-looking numbers a reader could mistake for a
 * clean bill of health.
 *
 * Nothing this function returns can alter an authorization decision: it has
 * no access to one, and its output type has no field that could carry a grant.
 */
export async function runSemanticEvaluation(
  options: RunSemanticEvaluationOptions,
): Promise<SemanticRunResult> {
  const { provider, breaker } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEMANTIC_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());

  const { input: redactedInput, summary } = redactSemanticInput(
    options.input,
    options.redactionLimits ?? DEFAULT_REDACTION_LIMITS,
  );
  const inputHash = hashRedactedInput(redactedInput);

  const degraded = (
    state: SemanticEvidenceState,
    latencyMs: number,
    errorCategory: string,
  ): SemanticRunResult => ({
    redactedInput,
    evidence: semanticEvidenceSchema.parse({
      schemaVersion: 1,
      mode: "shadow",
      authoritative: false,
      provider: provider.name,
      model: provider.model,
      modelVersion: provider.modelVersion,
      state,
      signals: null,
      indicators: [],
      confidence: 0,
      riskLevel: "unknown",
      latencyMs: Math.max(0, Math.round(latencyMs)),
      inputHash,
      redaction: summary,
      errorCategory,
      evaluatedAt: now().toISOString(),
    }),
  });

  if (breaker && !breaker.tryAcquire()) return degraded("circuit_open", 0, "circuit_open");

  const controller = new AbortController();
  const started = clock();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let raw: unknown;
  try {
    // Race the deadline as well as aborting: a provider that ignores the
    // signal must still not be able to hold the response open.
    raw = await Promise.race([
      provider.evaluate(redactedInput, { signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new SemanticProviderError("timeout", "deadline")),
        );
      }),
    ]);
  } catch (error) {
    const elapsed = clock() - started;
    if (error instanceof SemanticProviderUnavailableError) {
      // Not a provider *failure* — it was never reachable — so it does not trip the breaker.
      return degraded("unavailable", elapsed, "unavailable");
    }
    breaker?.recordFailure();
    if (timedOut) return degraded("timeout", timeoutMs, "timeout");
    const category = error instanceof SemanticProviderError ? error.category : "provider_error";
    return degraded("error", elapsed, /^[a-z_]{1,40}$/.test(category) ? category : "provider_error");
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = clock() - started;

  if (JSON.stringify(raw ?? null).length > MAX_PROVIDER_RESPONSE_CHARS) {
    breaker?.recordFailure();
    return degraded("error", latencyMs, "output_too_large");
  }

  const parsed = providerSignalPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    // Includes any extra key ("decision", "allow", "grantedTools", ...): a
    // structured-JSON reply does not make a provider trusted.
    breaker?.recordFailure();
    return degraded("error", latencyMs, "malformed_output");
  }
  breaker?.recordSuccess();

  const { signals, indicators, confidence } = parsed.data;
  return {
    redactedInput,
    evidence: semanticEvidenceSchema.parse({
      schemaVersion: 1,
      mode: "shadow",
      authoritative: false,
      provider: provider.name,
      model: provider.model,
      modelVersion: provider.modelVersion,
      state: "ok",
      signals,
      indicators: Array.from(new Set(indicators)),
      confidence,
      riskLevel: riskLevelFor(signals, confidence),
      latencyMs: Math.max(0, Math.round(latencyMs)),
      inputHash,
      redaction: summary,
      evaluatedAt: now().toISOString(),
    }),
  };
}
