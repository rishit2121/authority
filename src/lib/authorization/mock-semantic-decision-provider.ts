import {
  semanticDecisionResultSchema,
  type SemanticDecisionInput,
  type SemanticDecisionResult,
} from "@/lib/domain";

import {
  DEFAULT_SEMANTIC_TIMEOUT_MS,
  type SemanticDecisionProvider,
  type SemanticEvaluationOptions,
} from "./semantic-decision-provider";

/**
 * Deterministic stand-in for a real semantic provider.
 *
 * Part 1 makes no external calls and needs no API key. Signals are derived
 * from lexical overlap between the trusted task intent and the requested
 * tool/arguments — crude, but deterministic, instant, and enough to exercise
 * the evidence path end to end. Swapping in Jev later means implementing the
 * same port; nothing downstream changes.
 */
export interface MockSemanticDecisionProviderOptions {
  /** Force a degraded response, to exercise fallback behaviour in tests. */
  simulate?: "ok" | "timeout" | "error";
  /** Fixed latency reported on results, keeping test output stable. */
  latencyMs?: number;
  now?: () => Date;
}

const SENSITIVE_TOKENS = ["secret", "credential", "token", "password", "key", "env"];
const DISCLOSURE_TOOLS = ["send_message", "send_email", "upload", "post_message", "publish"];

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function overlapRatio(left: string[], right: string[]): number {
  if (right.length === 0) return 0;
  const haystack = new Set(left);
  const hits = right.filter((token) => haystack.has(token)).length;
  return hits / right.length;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}

export class MockSemanticDecisionProvider implements SemanticDecisionProvider {
  readonly name = "mock";

  private readonly simulate: "ok" | "timeout" | "error";
  private readonly latencyMs: number;
  private readonly now: () => Date;

  constructor(options: MockSemanticDecisionProviderOptions = {}) {
    this.simulate = options.simulate ?? "ok";
    this.latencyMs = options.latencyMs ?? 12;
    this.now = options.now ?? (() => new Date());
  }

  async evaluate(
    input: SemanticDecisionInput,
    options: SemanticEvaluationOptions = {},
  ): Promise<SemanticDecisionResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_SEMANTIC_TIMEOUT_MS;
    const evaluatedAt = this.now().toISOString();

    if (this.simulate !== "ok") {
      // Degraded responses still carry neutral probabilities so a caller that
      // ignores `state` cannot accidentally read them as permissive.
      return semanticDecisionResultSchema.parse({
        provider: this.name,
        model: "mock-heuristic",
        modelVersion: "0.1.0",
        taskRelevanceProbability: 0,
        resourceRelevanceProbability: 0,
        scopeExpansionProbability: 0,
        externalDisclosureProbability: 0,
        planConsistencyProbability: 0,
        semanticRiskProbability: 0,
        overallConfidence: 0,
        latencyMs: this.simulate === "timeout" ? timeoutMs : this.latencyMs,
        state: this.simulate,
        errorMessage:
          this.simulate === "timeout"
            ? `semantic provider exceeded ${timeoutMs}ms`
            : "semantic provider unavailable",
        evaluatedAt,
      });
    }

    const intentTokens = tokenize(input.taskIntent);
    const [, action = ""] = input.tool.split(".");
    const argumentTokens = tokenize(Object.values(input.arguments).flat().join(" "));

    const taskRelevance = clamp(0.25 + 0.75 * overlapRatio(intentTokens, tokenize(action)));
    const resourceRelevance = clamp(
      argumentTokens.length === 0 ? 0.5 : 0.2 + 0.8 * overlapRatio(intentTokens, argumentTokens),
    );

    // Scope expansion: asking for a tool the contract never listed.
    const scopeExpansion = input.contractAllowedTools.includes(input.tool) ? 0.05 : 0.9;

    const touchesSensitive = SENSITIVE_TOKENS.some(
      (token) => input.tool.includes(token) || argumentTokens.some((arg) => arg.includes(token)),
    );
    const externalDisclosure = clamp(
      (DISCLOSURE_TOOLS.some((tool) => action.includes(tool)) ? 0.6 : 0.05) + (touchesSensitive ? 0.3 : 0),
    );

    const planConsistency = clamp(
      input.priorPlanTools.length === 0 ? 0.8 : 0.5 + 0.5 * overlapRatio(input.priorPlanTools, [input.tool]),
    );

    const semanticRisk = clamp(
      0.5 * scopeExpansion +
        0.3 * externalDisclosure +
        0.2 * (1 - taskRelevance) +
        (touchesSensitive ? 0.2 : 0),
    );

    return semanticDecisionResultSchema.parse({
      provider: this.name,
      model: "mock-heuristic",
      modelVersion: "0.1.0",
      taskRelevanceProbability: taskRelevance,
      resourceRelevanceProbability: resourceRelevance,
      scopeExpansionProbability: scopeExpansion,
      externalDisclosureProbability: externalDisclosure,
      planConsistencyProbability: planConsistency,
      semanticRiskProbability: semanticRisk,
      overallConfidence: 0.62,
      latencyMs: this.latencyMs,
      state: "ok",
      evaluatedAt,
    });
  }
}
