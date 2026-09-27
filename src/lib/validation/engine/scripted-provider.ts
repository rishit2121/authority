import "server-only";

import type { SemanticRiskInput, SemanticSignals } from "@/lib/domain";
import { MockSemanticRiskProvider } from "@/lib/semantic/mock-provider";
import type { SemanticProviderCall, SemanticRiskProvider } from "@/lib/semantic/provider";

import type { SemanticScript } from "../schema";

const SIGNALS: Record<string, SemanticSignals> = {
  low: {
    taskAlignment: 0.92,
    resourceRelevance: 0.9,
    scopeExpansion: 0.05,
    externalDisclosure: 0.05,
    promptInjection: 0.02,
    suspiciousArgumentChange: 0.03,
    planDeviation: 0.03,
  },
  medium: {
    taskAlignment: 0.6,
    resourceRelevance: 0.6,
    scopeExpansion: 0.2,
    externalDisclosure: 0.2,
    promptInjection: 0.4,
    suspiciousArgumentChange: 0.25,
    planDeviation: 0.2,
  },
  high: {
    taskAlignment: 0.4,
    resourceRelevance: 0.5,
    scopeExpansion: 0.4,
    externalDisclosure: 0.4,
    promptInjection: 0.65,
    suspiciousArgumentChange: 0.3,
    planDeviation: 0.3,
  },
  critical: {
    taskAlignment: 0.1,
    resourceRelevance: 0.2,
    scopeExpansion: 0.8,
    externalDisclosure: 0.85,
    promptInjection: 0.9,
    suspiciousArgumentChange: 0.6,
    planDeviation: 0.7,
  },
};

/**
 * A semantic provider whose behavior a scenario can script: run the real mock heuristics (`auto`), inject a provider
 * fault (timeout, error, malformed reply, a reply carrying extra authority-shaped fields), or return a fixed verdict.
 * It goes through the SAME strict validation, circuit breaker and composition rules as a real provider.
 */
export class ScriptedSemanticProvider implements SemanticRiskProvider {
  readonly name = "mock";
  readonly model = "mock-heuristic";
  readonly modelVersion = "2026-09-28.1";
  private readonly delegate: MockSemanticRiskProvider;

  constructor(private readonly script: SemanticScript | undefined) {
    const simulate =
      script?.mode === "timeout"
        ? "timeout"
        : script?.mode === "error"
          ? "error"
          : script?.mode === "malformed"
            ? "malformed"
            : script?.mode === "extra_fields"
              ? "extra_fields"
              : undefined;
    this.delegate = new MockSemanticRiskProvider({ simulate, slowMs: 60_000 });
  }

  async evaluate(input: SemanticRiskInput, call: SemanticProviderCall): Promise<unknown> {
    if (this.script?.mode === "fixed") {
      const signals = SIGNALS[this.script.risk ?? "low"];
      return { signals, indicators: this.script.indicators ?? [], confidence: 0.9 };
    }
    return this.delegate.evaluate(input, call);
  }
}
