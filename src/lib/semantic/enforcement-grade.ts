/**
 * Mirrors `gateway.provider_enforcement_grade()` in the database, which is the
 * authority — this copy exists only so the settings UI can explain the rule
 * before a save is refused. Both are held to the same cases in tests.
 *
 * A hosted, real model is enforcement-grade. The deterministic mock and the
 * lexical baseline are heuristics: they may enforce only inside a development
 * tenant (tests and demos), never in staging or production.
 */
export type TenantEnvironment = "development" | "staging" | "production";

export function providerEnforcementGrade(provider: string, environment: TenantEnvironment): boolean {
  if (provider === "openai_compatible") return true;
  if (provider === "mock" || provider === "legacy_lexical") return environment === "development";
  return false;
}

export const RISK_CLASSES = ["low", "medium", "high"] as const;
export type RiskClassName = (typeof RISK_CLASSES)[number];
