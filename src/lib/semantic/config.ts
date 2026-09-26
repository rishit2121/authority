import { LegacyLexicalProvider } from "./legacy-provider";
import { MockSemanticRiskProvider } from "./mock-provider";
import { OpenAiCompatibleSemanticProvider } from "./openai-compatible-provider";
import type { SemanticRiskProvider } from "./provider";

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
