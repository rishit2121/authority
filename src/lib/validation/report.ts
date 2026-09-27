import { redactText } from "@/lib/github/redact";

import type { CampaignMetrics, Rate } from "./metrics";
import type { FindingDraft, RunResult, Severity } from "./schema";

/**
 * Human- and machine-readable campaign reports. Built only from stored/summarized results: no runtime secrets, no
 * raw arguments (steps carry sanitized request summaries), and every string is scrubbed of token-shaped text.
 */

export interface ReportInput {
  title: string;
  environment: { name: string; sandboxMinutes: number; limits: Record<string, number> };
  campaign: {
    id: string | null;
    status: string;
    seed: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    pack?: string | null;
    variants: string[];
    truncated: boolean;
    notes: string[];
  };
  versions: { gateway: string; registry: string; compiler: string };
  runs: Array<{
    result: RunResult;
    title: string;
    category: string;
    severity: Severity;
    intent: string;
    taxonomy: Array<{ framework: string; id: string; name: string }>;
    controls: string[];
    effectiveAuthority: { tools: string[]; semanticMode: string; approvalClasses: string[] };
  }>;
  findings: FindingDraft[];
  metrics: CampaignMetrics;
  regressions?: Array<{ key: string; status: string | null; lastRunAt: string | null }>;
}

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
const pct = (r: Rate) =>
  r.value === null
    ? "n/a"
    : `${(r.value * 100).toFixed(1)}% (${r.numerator}/${r.denominator}, 95% CI ${((r.low ?? 0) * 100).toFixed(0)}–${((r.high ?? 0) * 100).toFixed(0)}%)`;

function scrub<T>(v: T): T {
  return JSON.parse(redactText(JSON.stringify(v))) as T;
}

export function buildReportJson(input: ReportInput) {
  const bySeverity = Object.fromEntries(
    SEV_ORDER.map((s) => [s, input.findings.filter((f) => f.severity === s).length]),
  ) as Record<Severity, number>;
  const failedRuns = input.runs.filter((r) => r.result.verdict !== "pass");
  const leaks = input.runs.filter(
    (r) => r.result.metrics.attackAllowed > 0 || r.result.metrics.unauthorizedEffects > 0,
  );
  return scrub({
    reportVersion: 1,
    synthetic: true,
    title: input.title,
    generatedAt: new Date().toISOString(),
    environment: {
      ...input.environment,
      mocks: ["in-memory GitHub", "in-memory tool-effect ledger", "deterministic mock semantic provider"],
      isolation: "one throwaway sandbox tenant per run, destroyed on completion",
    },
    campaign: input.campaign,
    versions: input.versions,
    summary: {
      runs: input.metrics.runs,
      verdict: input.metrics.runs.failed + input.metrics.runs.errored === 0 ? "all_contained" : "gaps_found",
      findingsBySeverity: bySeverity,
      residualRisk: {
        runsWithUnauthorizedEffects: leaks.map((r) => `${r.result.scenarioKey}@${r.result.variant}`),
        unauthorizedEffects: input.metrics.residualBlastRadius.unauthorizedEffects,
      },
    },
    testedTasks: [
      ...new Map(
        input.runs.map((r) => [
          r.result.scenarioKey,
          { scenario: r.result.scenarioKey, intent: r.intent, authorizedTools: r.effectiveAuthority.tools },
        ]),
      ).values(),
    ],
    controlsTested: input.metrics.controlCoverage.controlsExercised,
    metrics: input.metrics,
    scenarios: input.runs.map((r) => ({
      key: r.result.scenarioKey,
      version: r.result.scenarioVersion,
      variant: r.result.variant,
      repetition: r.result.repetition,
      title: r.title,
      category: r.category,
      taxonomy: r.taxonomy,
      verdict: r.result.verdict,
      durationMs: r.result.durationMs,
      controlsExercised: r.controls,
      steps: r.result.steps.map((s) => ({
        seq: s.seq,
        id: s.stepKey,
        kind: s.kind,
        label: s.label,
        expected: s.expected,
        actual: {
          decision: s.actual.finalDecision,
          reasonCodes: s.actual.reasonCodes,
          capability: s.actual.capability,
          execution: s.actual.execution,
          resultCode: s.actual.resultCode,
        },
        control: s.control,
        verdict: s.verdict,
        mismatches: s.mismatches,
      })),
      effects: r.result.effects.map((e) => ({ tool: e.tool, step: e.stepKey, violates: e.violates })),
    })),
    findings: input.findings.map((f) => ({
      severity: f.severity,
      category: f.category,
      cause: f.cause,
      title: f.title,
      summary: f.summary,
      scenario: f.scenarioKey,
      run: f.runKey,
      evidence: f.evidence,
      remediations: f.remediations.map((r) => ({
        kind: r.kind,
        title: r.title,
        rationale: r.rationale,
        patch: r.patch,
        humanSteps: r.humanSteps,
        agentGuidance: r.agentGuidance,
        broadensAuthority: r.broadensAuthority,
        requiresHumanReview: r.requiresHumanReview,
      })),
    })),
    regression: input.regressions ?? [],
    recommendedRemediation: [
      ...new Set(
        input.findings.flatMap((f) =>
          f.remediations.filter((r) => r.kind !== "add_regression_scenario").map((r) => r.title),
        ),
      ),
    ],
    failedRuns: failedRuns.map((r) => `${r.result.scenarioKey}@${r.result.variant}`),
    limitations: input.metrics.limitations,
  });
}

export function buildReportMarkdown(input: ReportInput): string {
  const j = buildReportJson(input) as ReturnType<typeof buildReportJson> & Record<string, unknown>;
  const m = input.metrics;
  const L: string[] = [];
  L.push(
    `# ${input.title}`,
    "",
    `> **Synthetic validation.** Results come from fake tenants, mock integrations and a rule-based mock semantic provider. They are not a production guarantee.`,
    "",
  );
  L.push("## Executive summary", "");
  L.push(
    `- Verdict: **${j.summary.verdict === "all_contained" ? "every attack contained" : "gaps found"}**  (${m.runs.passed} passed, ${m.runs.failed} failed, ${m.runs.errored} errored of ${m.runs.total} runs)`,
  );
  L.push(
    `- Attack containment: ${pct(m.attackContainmentRate)}`,
    `- Unauthorized-operation block rate: ${pct(m.unauthorizedOperationBlockRate)}`,
    `- False negatives: ${pct(m.falseNegativeRate)}`,
    `- False positives (benign refused): ${pct(m.falsePositiveRate)}`,
  );
  L.push(
    `- Findings: ${SEV_ORDER.map((s) => `${j.summary.findingsBySeverity[s]} ${s}`).join(", ")}`,
    `- Residual blast radius: ${m.residualBlastRadius.unauthorizedEffects} unauthorized effect(s)`,
    "",
  );
  L.push(
    "## Environment",
    "",
    `- Campaign ${input.campaign.id ?? "(ephemeral)"} · seed ${input.campaign.seed} · ${input.campaign.status} · ${input.campaign.durationMs} ms`,
    `- Environment: ${input.environment.name}; one throwaway sandbox tenant per run, destroyed afterwards; mocks: in-memory GitHub, in-memory tool-effect ledger, deterministic mock semantic provider`,
    `- Versions: gateway ${input.versions.gateway}, registry ${input.versions.registry}, compiler ${input.versions.compiler}`,
    `- Variants run: ${input.campaign.variants.join(", ")}`,
    "",
  );
  L.push("## Measurements", "", "| Measurement | Value |", "| --- | --- |");
  L.push(
    `| Least-privilege exposure (granted, unused by legitimate work) | ${pct(m.leastPrivilegeExposure)} |`,
    `| Deterministic/semantic disagreement (per decision) | ${pct(m.deterministicSemanticDisagreement)} |`,
    `| Capability replay resistance | ${pct(m.capabilityReplayResistance)} |`,
    `| Approval-bypass resistance | ${pct(m.approvalBypassResistance)} |`,
    `| Decision latency p50 / p95 | ${m.decisionLatencyMs.p50 ?? "n/a"} / ${m.decisionLatencyMs.p95 ?? "n/a"} ms (n=${m.decisionLatencyMs.samples}) |`,
    `| Time to detection (median) | ${m.timeToDetectionMs.median ?? "n/a"} ms (n=${m.timeToDetectionMs.samples}) |`,
    `| Control coverage | ${m.controlCoverage.controlsExercised.length} of ${m.controlCoverage.controlsAvailable} controls exercised (${m.controlCoverage.controlsExercised.join(", ") || "none"}) |`,
    `| Regression status | ${m.regression.passing}/${m.regression.total} passing |`,
    "",
  );
  L.push(
    "## Scenario results",
    "",
    "| Scenario | Variant | Verdict | Controls | Duration |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const r of input.runs)
    L.push(
      `| ${r.title} | ${r.result.variant} | ${r.result.verdict.toUpperCase()} | ${r.controls.join(", ") || "n/a"} | ${r.result.durationMs} ms |`,
    );
  L.push("");
  L.push("## Findings", "");
  if (input.findings.length === 0) L.push("No findings.", "");
  for (const s of SEV_ORDER) {
    const list = input.findings.filter((f) => f.severity === s);
    if (list.length === 0) continue;
    L.push(`### ${s.toUpperCase()} (${list.length})`, "");
    for (const f of list) {
      L.push(
        `#### ${f.title}`,
        "",
        f.summary,
        "",
        `- Scenario: \`${f.runKey}\` · category: ${f.category} · cause: ${f.cause}`,
      );
      const ev = f.evidence as {
        actual?: { finalDecision?: string; reasonCodes?: string[]; execution?: string };
        responsibleControl?: string;
      };
      if (ev.actual)
        L.push(
          `- Evidence: decision \`${ev.actual.finalDecision ?? "none"}\`, reasons \`${(ev.actual.reasonCodes ?? []).join(", ") || "none"}\`, execution \`${ev.actual.execution}\`, responsible control \`${ev.responsibleControl ?? "none"}\``,
        );
      for (const r of f.remediations)
        L.push(`- **Proposed** (human review required, never auto-applied): ${r.title} — ${r.rationale}`);
      L.push("");
    }
  }
  L.push(
    "## Residual risk",
    "",
    m.residualBlastRadius.unauthorizedEffects === 0
      ? "No unauthorized effect occurred in the scenarios run."
      : `Unauthorized effects occurred in: ${m.residualBlastRadius.scenariosWithEffects.join(", ")}.`,
    "",
  );
  L.push(
    "## Limitations",
    "",
    ...m.limitations.map((x) => `- ${x}`),
    ...input.campaign.notes.map((n) => `- ${n}`),
    "",
  );
  return redactText(L.join("\n"));
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Self-contained, printable HTML (no scripts, no external assets). */
export function buildReportHtml(input: ReportInput): string {
  const md = buildReportMarkdown(input);
  const body = md
    .split("\n")
    .map((line) => {
      if (line.startsWith("#### ")) return `<h4>${esc(line.slice(5))}</h4>`;
      if (line.startsWith("### ")) return `<h3>${esc(line.slice(4))}</h3>`;
      if (line.startsWith("## ")) return `<h2>${esc(line.slice(3))}</h2>`;
      if (line.startsWith("# ")) return `<h1>${esc(line.slice(2))}</h1>`;
      if (line.startsWith("> "))
        return `<blockquote>${esc(line.slice(2)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</blockquote>`;
      if (line.startsWith("| ---")) return "";
      if (line.startsWith("|")) {
        const cells = line
          .split("|")
          .slice(1, -1)
          .map((c) => esc(c.trim()));
        return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
      }
      if (line.startsWith("- "))
        return `<li>${esc(line.slice(2))
          .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
          .replace(/`(.+?)`/g, "<code>$1</code>")}</li>`;
      return line.trim() ? `<p>${esc(line).replace(/`(.+?)`/g, "<code>$1</code>")}</p>` : "";
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(input.title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1b1f24}h1,h2,h3,h4{margin:1.4em 0 .4em}table{border-collapse:collapse}td{border:1px solid #d0d7de;padding:4px 8px}code{background:#f0f2f4;padding:1px 4px;border-radius:3px}blockquote{border-left:4px solid #d4a72c;background:#fff8e1;margin:1em 0;padding:.6em 1em}</style></head><body>${body}</body></html>`;
}
