import type { SemanticMode } from "@/lib/domain";

import { LegacyLexicalProvider } from "./legacy-provider";
import { MockSemanticRiskProvider } from "./mock-provider";
import { OpenAiCompatibleSemanticProvider } from "./openai-compatible-provider";
import type { SemanticRiskProvider } from "./provider";

export type EffectiveSemanticMode = "off" | "shadow";

/**
 * Maps a configured mode to what may actually run. `enforce` can never be
 * stored (a database CHECK forbids it) and is refused here as well: it
 * resolves to `off` with `enforcementUnavailable`, i.e. it fails closed into
 * "no semantic influence at all" rather than pretending to enforce. Enabling
 * it requires the Part 6 trusted gateway (docs/semantic/SHADOW_MODE.md).
 */
export function resolveEffectiveMode(mode: SemanticMode): {
  effective: EffectiveSemanticMode;
  enforcementUnavailable: boolean;
} {
  if (mode === "shadow") return { effective: "shadow", enforcementUnavailable: false };
  if (mode === "enforce") return { effective: "off", enforcementUnavailable: true };
  return { effective: "off", enforcementUnavailable: false };
}

export function createSemanticProvider(name: string, model: string): SemanticRiskProvider {
  switch (name) {
    case "openai_compatible":
      return new OpenAiCompatibleSemanticProvider(model);
    case "legacy_lexical":
      return new LegacyLexicalProvider();
    case "mock":
    default:
      return new MockSemanticRiskProvider();
  }
}
