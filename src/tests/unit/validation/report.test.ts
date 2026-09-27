import { describe, expect, it } from "vitest";

import { agentGuidance } from "@/lib/gateway/guidance";
import { aggregateMetrics, emptyMetrics } from "@/lib/validation/metrics";
import {
  buildReportHtml,
  buildReportJson,
  buildReportMarkdown,
  type ReportInput,
} from "@/lib/validation/report";
import type { FindingDraft, RunResult } from "@/lib/validation/schema";

const TOKEN = "authcap_v1_" + "A".repeat(43);
const KEY = "authority_rk_" + "ab".repeat(32);
const GHP = "ghp_" + "a".repeat(36);

const result: RunResult = {
  scenarioKey: "s1",
  scenarioVersion: 1,
  variant: "baseline",
  repetition: 1,
  seed: 1,
  status: "completed",
  verdict: "fail",
  steps: [],
  effects: [],
  metrics: { ...emptyMetrics(), attackSteps: 1, attackAllowed: 1, unauthorizedEffects: 1 },
  durationMs: 12,
};
const finding: FindingDraft = {
  scenarioKey: "s1",
  runKey: "s1@baseline#1",
  stepSeq: 1,
  severity: "high",
  category: "recipient_substitution",
  cause: "wrong_resource",
  title: `Leak <script>alert(1)</script> with ${TOKEN}`,
  summary: `token ${KEY} and ${GHP} appeared`,
  evidence: { note: `Bearer ${TOKEN}` },
  remediations: [],
};
const input: ReportInput = {
  title: "Report <b>x</b>",
  environment: { name: "env", sandboxMinutes: 15, limits: { maxRuns: 120 } },
  campaign: {
    id: null,
    status: "completed",
    seed: 1,
    startedAt: "2026-09-26T00:00:00Z",
    finishedAt: "2026-09-26T00:00:01Z",
    durationMs: 1000,
    variants: ["baseline"],
    truncated: false,
    notes: [],
  },
  versions: { gateway: "g", registry: "r", compiler: "c" },
  runs: [
    {
      result,
      title: "Scenario one",
      category: "recipient_substitution",
      severity: "high",
      intent: "Send a receipt",
      taxonomy: [],
      controls: ["capability"],
      effectiveAuthority: { tools: ["gmail.send_email"], semanticMode: "off", approvalClasses: [] },
    },
  ],
  findings: [finding],
  metrics: aggregateMetrics([result], 25),
};

describe("reports", () => {
  it("contain no capability tokens, runtime keys or GitHub tokens in any format", () => {
    for (const out of [
      JSON.stringify(buildReportJson(input)),
      buildReportMarkdown(input),
      buildReportHtml(input),
    ]) {
      expect(out).not.toContain(TOKEN);
      expect(out).not.toContain(KEY);
      expect(out).not.toContain(GHP);
      expect(out).not.toMatch(
        /authcap_v1_[A-Za-z0-9_-]{20,}|authority_rk_[0-9a-f]{20,}|ghp_[A-Za-z0-9]{20,}/,
      );
    }
  });

  it("HTML escapes untrusted text and is self-contained", () => {
    const html = buildReportHtml(input);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;");
    expect(html).not.toMatch(/<script|<link|<img|src=|href="http/i);
  });

  it("states that results are synthetic and lists limitations, in every human-readable format", () => {
    const md = buildReportMarkdown(input);
    expect(md).toMatch(/synthetic/i);
    expect(md).toMatch(/limitations/i);
    expect(md).toContain("Findings");
    expect(buildReportHtml(input)).toMatch(/synthetic/i);
    const json = buildReportJson(input) as unknown as Record<string, unknown>;
    expect(JSON.stringify(json)).toMatch(/synthetic/i);
  });

  it("is deterministic for the same input", () => {
    const strip = (r: object) => JSON.stringify({ ...r, generatedAt: undefined });
    expect(strip(buildReportJson(input))).toBe(strip(buildReportJson(input)));
    expect(buildReportMarkdown(input)).toBe(buildReportMarkdown(input));
  });
});

describe("agent recovery guidance", () => {
  it("tells the agent what to do next without leaking why the control fired", () => {
    const cases: Array<[string | null, string[], string]> = [
      ["deny", ["FORBIDDEN_RESOURCE"], "stop"],
      ["require_approval", ["POLICY_REQUIRES_APPROVAL"], "request_approval"],
      ["replan", ["TOOL_NOT_IN_CONTRACT"], "replan"],
      ["deny", ["CONSTRAINT_VIOLATION"], "replan"],
      ["clarify", ["ARGUMENTS_UNDERSPECIFIED"], "clarify"],
      ["deny", ["NO_ACTIVE_CONTRACT"], "stop"],
      ["deny", ["SECURITY_REVIEW_UNAVAILABLE"], "retry_later"],
      ["allow", ["WITHIN_CONTRACT"], "proceed"],
      ["deny", ["SOMETHING_NEW"], "stop"],
    ];
    for (const [outcome, codes, next] of cases) {
      const g = agentGuidance(outcome, codes);
      expect(g.nextStep, codes.join()).toBe(next);
      // No reason code, threshold, indicator or provider name in the message: it must not be an oracle.
      for (const c of codes) expect(g.message).not.toContain(c);
      expect(g.message).not.toMatch(/threshold|indicator|classifier|risk score|semantic/i);
    }
  });

  it("only ever advises asking for MORE authority from a human, never taking it", () => {
    for (const code of [
      "FORBIDDEN_RESOURCE",
      "CONSTRAINT_VIOLATION",
      "TOOL_NOT_IN_CONTRACT",
      "INVOCATION_LIMIT_REACHED",
    ]) {
      expect(agentGuidance("deny", [code]).message).not.toMatch(
        /grant yourself|widen|elevate|bypass|override/i,
      );
    }
  });
});
