import { RevokeCapabilityButton } from "@/components/runtime/RevokeCapabilityButton";
import { SemanticEvidenceDetail } from "@/components/semantic/SemanticEvidenceDetail";
import { SemanticShadowBadge } from "@/components/semantic/SemanticShadowBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusRow } from "@/components/ui/StatusRow";
import { presentDecisionStatus } from "@/lib/authorization/decision-status";
import type { DecisionStatus } from "@/lib/domain";
import { buildRuntimeRows, decisionTrace, type RuntimeRow } from "@/lib/runtime/dashboard-model";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import {
  EVIDENCE_COLUMNS,
  GATEWAY_EVIDENCE_COLUMNS,
  RISK_ORDER,
  summarizeHealth,
  toEvidenceView,
} from "@/lib/semantic/read-model";

const CAPABILITY_CLASSES: Record<string, string> = {
  active: "border-allow/30 bg-allow/10 text-allow",
  consumed: "border-outline-variant/40 bg-surface-container-high text-outline",
  revoked: "border-deny/40 bg-deny/10 text-deny",
  expired: "border-secondary/40 bg-secondary/10 text-secondary",
};

const MODE_LABEL: Record<string, string> = {
  off: "semantic off",
  shadow: "semantic shadow",
  enforce: "semantic ENFORCE",
};

const JEV_RISK_CLASSES: Record<string, string> = {
  low: "border-allow/30 bg-allow/10 text-allow",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  high: "border-deny/30 bg-deny/10 text-deny",
  critical: "border-deny/50 bg-deny/20 text-deny",
};

const select =
  "rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface";

function OutcomePill({ outcome }: { outcome: string }) {
  const p = presentDecisionStatus(outcome as DecisionStatus);
  return <span className="inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px]">{p.label}</span>;
}

/**
 * Runtime authorization dashboard.
 *
 * Every row shows the three results separately — deterministic, semantic and
 * final composed — plus which enforcement mode produced the decision and the
 * capability's lifecycle. Everything is read through the caller's own RLS scope
 * from what the gateway persisted. Part 6 executes no external tool: capability
 * consumption is simulated, and every capability cell says so.
 */
export default async function RuntimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant("/app/runtime");
  const db = context.supabase;

  const [agents, decisionsResult] = await Promise.all([
    repositories.agents.listByTenant(identity.tenant.tenantId),
    db
      .from("authorization_decisions")
      .select("id, outcome, reason_codes, contract_id, contract_version, tool_request_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const decisions = decisionsResult.data ?? [];
  const decisionIds = decisions.map((d) => d.id);
  const requestIds = decisions.map((d) => d.tool_request_id);

  const [requests, finals, gatewayEvidence, legacyEvidence, jevRiskRows] = decisionIds.length
    ? await Promise.all([
        db
          .from("tool_requests")
          .select("id, tool, operation, resource, task_id, agent_id, arguments_redacted")
          .in("id", requestIds),
        db
          .from("final_decisions")
          .select(
            "id, authorization_decision_id, deterministic_outcome, final_outcome, semantic_mode, semantic_policy, risk_class, composition_reasons, degraded, degraded_reason, narrowed",
          )
          .in("authorization_decision_id", decisionIds),
        db
          .from("semantic_evaluations")
          .select(GATEWAY_EVIDENCE_COLUMNS)
          .in("authorization_decision_id", decisionIds),
        db
          .from("semantic_shadow_evaluations")
          .select(EVIDENCE_COLUMNS)
          .in("authorization_decision_id", decisionIds),
        db
          .from("jev_risk_evaluations")
          .select(
            "authorization_decision_id, provider, model, state, result, disagreement, latency_ms, error_category",
          )
          .in("authorization_decision_id", decisionIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const finalIds = (finals.data ?? []).map((f) => f.id);
  const [tokens] = finalIds.length
    ? await Promise.all([
        db
          .from("capability_tokens")
          .select(
            "id, final_decision_id, issued_at, expires_at, max_uses, uses, status, revoked_by, revocation_reason",
          )
          .in("final_decision_id", finalIds),
      ])
    : [{ data: [] }];
  const tokenIds = (tokens.data ?? []).map((t) => t.id);
  const consumptions = tokenIds.length
    ? await db
        .from("capability_consumptions")
        .select("capability_id, result, reason_code")
        .in("capability_id", tokenIds)
    : { data: [] };

  const evidenceByDecision = new Map(
    [...(legacyEvidence.data ?? []), ...(gatewayEvidence.data ?? [])].map((r) => [
      r.authorization_decision_id,
      toEvidenceView(r),
    ]),
  );
  const jevRiskByDecision = new Map((jevRiskRows.data ?? []).map((r) => [r.authorization_decision_id, r]));

  const all = buildRuntimeRows({
    decisions,
    requests: requests.data ?? [],
    finals: finals.data ?? [],
    tokens: tokens.data ?? [],
    consumptions: consumptions.data ?? [],
    evidenceByDecision,
    jevRiskByDecision,
    agentNames: new Map(agents.map((a) => [a.id, a.name])),
  });

  const search = params.search?.trim().toLowerCase();

  const rows = all
    .filter((r) => !params.agentId || r.agentId === params.agentId)
    .filter((r) => !params.taskId || r.taskId === params.taskId)
    .filter((r) => !params.tool || r.tool === params.tool)
    .filter((r) => !params.outcome || r.final === params.outcome)
    .filter((r) => !params.mode || r.semanticMode === params.mode)
    .filter((r) => !params.capability || (r.capability?.state ?? "none") === params.capability)
    .filter((r) => !params.degraded || r.degraded === (params.degraded === "yes"))
    .filter((r) => !params.risk || (r.evidence?.riskLevel ?? "not_evaluated") === params.risk)
    .filter((r) => !params.provider || r.evidence?.provider === params.provider)
    .filter((r) => !params.disagreement || r.evidence?.disagreement === params.disagreement)
    .filter(
      (r) =>
        !search ||
        r.tool.toLowerCase().includes(search) ||
        r.agentName.toLowerCase().includes(search) ||
        (r.resource ?? "").toLowerCase().includes(search),
    );

  const tools = Array.from(new Set(all.map((r) => r.tool))).sort();
  const providers = Array.from(new Set([...evidenceByDecision.values()].map((e) => e.provider))).sort();
  const health = summarizeHealth([...evidenceByDecision.values()]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const callsToday = all.filter((r) => new Date(r.createdAt) >= today).length;
  const allowedCount = all.filter((r) => r.final === "allow" || r.final === "allow_constrained").length;
  const deniedCount = all.filter((r) => r.final === "deny").length;
  const awaitingApprovalCount = all.filter((r) => r.final === "require_approval").length;

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Activity"
        description="Every authorization request, its decision, and the authority issued."
      />

      <StatusRow
        items={[
          { label: "Calls today", value: callsToday },
          { label: "Allowed", value: allowedCount },
          { label: "Denied", value: deniedCount, emphasis: "attention" },
          { label: "Awaiting approval", value: awaitingApprovalCount },
        ]}
      />

      <p
        data-testid="simulation-notice"
        className="max-w-3xl rounded-lg border border-line bg-paper-raised p-4 text-[13px] text-ink"
      >
        <strong>Simulation — no external tool was executed.</strong> Capabilities are issued and consumed
        against a simulated endpoint; nothing here reflects a real GitHub, Stripe or other side effect.
      </p>
      <p
        data-testid="semantic-shadow-notice"
        className="max-w-3xl rounded-lg border border-line bg-paper p-4 text-[13px] text-ink-soft"
      >
        In <strong>shadow</strong> mode the AI risk signal is recorded but never changes a decision — advisory
        only. In <strong>enforce</strong> mode it can only narrow a deterministic allow. The mode that
        produced each decision is shown on its row.
      </p>

      {health.length > 0 ? (
        <ul
          data-testid="provider-health"
          className="flex flex-wrap gap-3 font-mono-code text-[11px] text-on-surface-variant"
        >
          {health.map((h) => (
            <li
              key={h.provider}
              className="rounded border border-outline-variant/30 bg-surface-container px-2 py-1"
            >
              {h.provider}: {h.ok}/{h.total} ok · {h.timeout} timeout · {h.error} error · p95 {h.p95LatencyMs}{" "}
              ms
            </li>
          ))}
        </ul>
      ) : null}

      <form className="flex flex-col gap-3" method="get">
        <div className="flex flex-wrap items-center gap-2">
          <select
            name="outcome"
            defaultValue={params.outcome ?? ""}
            aria-label="Final decision"
            className={select}
          >
            <option value="">Any final decision</option>
            {["allow", "allow_constrained", "clarify", "replan", "require_approval", "deny"].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <select name="agentId" defaultValue={params.agentId ?? ""} aria-label="Agent" className={select}>
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            type="search"
            name="search"
            defaultValue={params.search ?? ""}
            aria-label="Search tool calls"
            placeholder="Search tool, agent, resource…"
            className="rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface"
          />
          <button
            type="submit"
            className="rounded border border-outline-variant/40 bg-surface-container-high px-3 py-1 font-label-sm text-label-sm text-on-surface"
          >
            Filter
          </button>
        </div>

        <details>
          <summary className="w-fit cursor-pointer font-label-sm text-label-sm text-on-surface-variant underline-offset-2 hover:underline">
            More filters
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select name="tool" defaultValue={params.tool ?? ""} aria-label="Tool" className={select}>
              <option value="">All tools</option>
              {tools.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              name="mode"
              defaultValue={params.mode ?? ""}
              aria-label="Enforcement mode"
              className={select}
            >
              <option value="">Any mode</option>
              {["off", "shadow", "enforce"].map((m) => (
                <option key={m} value={m}>
                  semantic {m}
                </option>
              ))}
            </select>
            <select
              name="capability"
              defaultValue={params.capability ?? ""}
              aria-label="Capability state"
              className={select}
            >
              <option value="">Any capability state</option>
              {["active", "consumed", "revoked", "expired", "none"].map((s) => (
                <option key={s} value={s}>
                  capability {s}
                </option>
              ))}
            </select>
            <select
              name="degraded"
              defaultValue={params.degraded ?? ""}
              aria-label="Degraded"
              className={select}
            >
              <option value="">Degraded or not</option>
              <option value="yes">Degraded / fail-closed</option>
              <option value="no">Not degraded</option>
            </select>
            <select
              name="risk"
              defaultValue={params.risk ?? ""}
              aria-label="Semantic risk"
              className={select}
            >
              <option value="">Any semantic risk</option>
              {[...RISK_ORDER, "not_evaluated"].map((r) => (
                <option key={r} value={r}>
                  {r.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              name="provider"
              defaultValue={params.provider ?? ""}
              aria-label="Semantic provider"
              className={select}
            >
              <option value="">Any provider</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              name="disagreement"
              defaultValue={params.disagreement ?? ""}
              aria-label="Disagreement"
              className={select}
            >
              <option value="">Any disagreement</option>
              <option value="semantic_flags_permitted">Semantic flags a permitted request</option>
              <option value="semantic_clears_denied">Semantic clears a denied request</option>
            </select>
          </div>
        </details>
      </form>

      {rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState
            icon="bolt"
            heading="No tool calls yet"
            description="Authorization requests from registered agents will appear here."
          />
        ) : (
          <p className="text-[13px] text-ink-soft">No tool calls match these filters.</p>
        )
      ) : (
        <div className="overflow-auto rounded-xl border border-outline-variant/30 bg-surface-container">
          <table className="w-full min-w-[1240px] border-collapse text-left">
            <caption className="sr-only">Recent runtime authorization decisions</caption>
            <thead>
              <tr className="border-b border-outline-variant/30">
                {[
                  "Time",
                  "Agent · tool",
                  "Deterministic",
                  "Semantic",
                  "Jev risk (shadow)",
                  "Final decision",
                  "Capability (simulation)",
                  "Trace",
                ].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="whitespace-nowrap px-space-lg py-space-md font-label-caps text-label-caps uppercase tracking-widest text-outline"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.decisionId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ row }: { row: RuntimeRow }) {
  const cap = row.capability;
  return (
    <tr className="border-b border-outline-variant/20 align-top last:border-b-0" data-testid="runtime-row">
      <td className="whitespace-nowrap px-space-lg py-space-md font-mono-code text-[11px] text-outline">
        {new Date(row.createdAt).toLocaleString()}
      </td>
      <td className="px-space-lg py-space-md">
        <span className="block font-body-sm text-body-sm text-on-surface-variant">{row.agentName}</span>
        <span className="block font-mono-code text-[12px] text-on-surface">
          {row.tool}
          {row.resource ? <span className="ml-1 text-outline">· {row.resource}</span> : null}
        </span>
        <span className="block font-mono-code text-[10px] text-outline">
          {row.argumentsRedacted ? "arguments redacted at rest" : "pre-Part-6 record"}
        </span>
      </td>
      <td className="px-space-lg py-space-md" data-testid="deterministic-cell">
        <OutcomePill outcome={row.deterministic} />
      </td>
      <td className="px-space-lg py-space-md" data-testid="semantic-cell">
        <span className="mb-1 block font-mono-code text-[10px] uppercase tracking-wider text-outline">
          {MODE_LABEL[row.semanticMode] ?? row.semanticMode}
        </span>
        <SemanticShadowBadge evidence={row.evidence} enforcing={row.semanticMode === "enforce"} />
        {row.evidence && row.evidence.disagreement !== "none" ? (
          <span className="mt-1 block font-mono-code text-[10px] text-secondary">
            ⚠ disagrees with deterministic decision
          </span>
        ) : null}
      </td>
      <td className="px-space-lg py-space-md" data-testid="jev-risk-cell">
        {row.jevRisk ? (
          <div className="flex flex-col gap-1">
            {row.jevRisk.state === "ok" ? (
              <>
                <span
                  className={`inline-flex w-fit rounded border px-2 py-0.5 font-mono-code text-[11px] ${JEV_RISK_CLASSES[row.jevRisk.riskClass ?? ""] ?? "border-outline-variant/40 text-on-surface-variant"}`}
                >
                  {row.jevRisk.riskClass ?? "unknown"}-risk
                </span>
                <span className="font-mono-code text-[10px] text-outline">
                  confidence {row.jevRisk.confidence != null ? row.jevRisk.confidence.toFixed(2) : "—"} ·{" "}
                  {row.jevRisk.provider} · {row.jevRisk.latencyMs}ms
                </span>
                {row.jevRisk.disagreement ? (
                  <span className="font-mono-code text-[10px] text-secondary">
                    ⚠ disagrees with final decision
                  </span>
                ) : null}
              </>
            ) : (
              <span className="font-mono-code text-[11px] text-outline">
                {row.jevRisk.state} ({row.jevRisk.errorCategory ?? "no evidence"})
              </span>
            )}
            <span className="font-mono-code text-[10px] text-outline">
              shadow only — never affected this decision
            </span>
          </div>
        ) : (
          <span className="font-mono-code text-[11px] text-outline">not evaluated</span>
        )}
      </td>
      <td className="px-space-lg py-space-md" data-testid="final-cell">
        <OutcomePill outcome={row.final} />
        <span className="mt-1 block font-mono-code text-[10px] text-outline">
          {row.gateway ? MODE_LABEL[row.semanticMode] : "pre-gateway"}
        </span>
        {row.narrowed ? (
          <span data-testid="narrowed" className="mt-1 block font-mono-code text-[10px] text-secondary">
            narrowed from {row.deterministic}
          </span>
        ) : null}
        {row.degraded ? (
          <span data-testid="degraded" className="mt-1 block font-mono-code text-[10px] text-deny">
            degraded: {row.degradedReason}
            {row.final === "deny" ? " — failed closed" : " — deterministic result kept"}
          </span>
        ) : null}
      </td>
      <td className="px-space-lg py-space-md" data-testid="capability-cell">
        {cap ? (
          <div className="flex flex-col gap-1">
            <span
              className={`inline-flex w-fit rounded border px-2 py-0.5 font-mono-code text-[11px] ${CAPABILITY_CLASSES[cap.state]}`}
            >
              {cap.state}
            </span>
            <span className="font-mono-code text-[10px] text-outline">
              {cap.remainingUses}/{cap.maxUses} uses left
              {cap.state === "active" ? ` · ${cap.ttlRemainingSeconds}s left` : ""}
            </span>
            <span className="font-mono-code text-[10px] text-outline">
              {cap.acceptedConsumptions} simulated use{cap.acceptedConsumptions === 1 ? "" : "s"}
              {cap.replayAttempts > 0
                ? ` · ${cap.replayAttempts} replay attempt${cap.replayAttempts === 1 ? "" : "s"}`
                : ""}
            </span>
            {cap.state === "revoked" ? (
              <span className="font-mono-code text-[10px] text-deny">by {cap.revokedBy}</span>
            ) : null}
            {cap.state === "active" ? <RevokeCapabilityButton capabilityId={cap.id} /> : null}
          </div>
        ) : (
          <span className="font-mono-code text-[11px] text-outline">none</span>
        )}
      </td>
      <td className="px-space-lg py-space-md">
        <details>
          <summary className="cursor-pointer font-label-sm text-label-sm text-on-surface-variant underline-offset-2 hover:underline">
            Decision trace
          </summary>
          <ol className="mt-2 flex max-w-sm flex-col gap-1 font-mono-code text-[11px] text-on-surface-variant">
            {decisionTrace(row).map((s) => (
              <li key={s.step}>
                <strong className="text-on-surface">{s.step}:</strong> {s.detail}
              </li>
            ))}
          </ol>
          {row.evidence ? (
            <div className="mt-2">
              <SemanticEvidenceDetail evidence={row.evidence} />
            </div>
          ) : null}
        </details>
      </td>
    </tr>
  );
}
