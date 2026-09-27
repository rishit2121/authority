import type { TaxonomyRef } from "./schema";

/**
 * Only references whose IDs and names were checked against the official sources:
 *  - OWASP Top 10 for LLM Applications 2025 (genai.owasp.org/llm-top-10)
 *  - OWASP "Agentic AI – Threats and Mitigations" v1.0 threat IDs T1–T15 (genai.owasp.org/resource/agentic-ai-threats-and-mitigations)
 *  - MITRE ATLAS technique IDs (checked against github.com/mitre-atlas/atlas-data dist/ATLAS.yaml)
 * A scenario is mapped only where the mapping is accurate; many scenarios deliberately carry none.
 */
const REFS = {
  LLM01: { framework: "owasp-llm-2025", id: "LLM01:2025", name: "Prompt Injection" },
  LLM02: { framework: "owasp-llm-2025", id: "LLM02:2025", name: "Sensitive Information Disclosure" },
  LLM06: { framework: "owasp-llm-2025", id: "LLM06:2025", name: "Excessive Agency" },
  LLM10: { framework: "owasp-llm-2025", id: "LLM10:2025", name: "Unbounded Consumption" },
  T2: { framework: "owasp-agentic-t", id: "T2", name: "Tool Misuse" },
  T3: { framework: "owasp-agentic-t", id: "T3", name: "Privilege Compromise" },
  T6: { framework: "owasp-agentic-t", id: "T6", name: "Intent Breaking & Goal Manipulation" },
  T9: { framework: "owasp-agentic-t", id: "T9", name: "Identity Spoofing & Impersonation" },
  "AML.T0051.000": { framework: "mitre-atlas", id: "AML.T0051.000", name: "LLM Prompt Injection: Direct" },
  "AML.T0051.001": { framework: "mitre-atlas", id: "AML.T0051.001", name: "LLM Prompt Injection: Indirect" },
  "AML.T0053": { framework: "mitre-atlas", id: "AML.T0053", name: "AI Agent Tool Invocation" },
  "AML.T0086": {
    framework: "mitre-atlas",
    id: "AML.T0086",
    name: "Exfiltration via AI Agent Tool Invocation",
  },
} as const satisfies Record<string, TaxonomyRef>;

export type TaxonomyKey = keyof typeof REFS;

export function tx(...keys: TaxonomyKey[]): TaxonomyRef[] {
  return keys.map((k) => ({ ...REFS[k] }));
}

export const ALL_TAXONOMY: readonly TaxonomyRef[] = Object.values(REFS);
