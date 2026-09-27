import type { StepView } from "@/lib/validation/read-model";

import { CONTROL_LABEL, VERDICT_CLASS } from "./labels";

const dash = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));
const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(" | ") : "—");

interface Actual {
  finalDecision?: string | null;
  deterministicDecision?: string | null;
  reasonCodes?: string[];
  capability?: string;
  execution?: string;
  resultCode?: string | null;
  executedCount?: number;
  replayed?: boolean;
  semantic?: {
    state: string | null;
    risk: string | null;
    provider: string | null;
    indicators: string[];
    narrowed: boolean;
  } | null;
  guidance?: { nextStep: string; message: string } | null;
}
interface Expected {
  decision?: string[];
  capability?: string;
  execution?: string;
  resultCodes?: string[];
  control?: string[];
  executedAtMost?: number;
  executedExactly?: number;
  replayed?: boolean;
}

/** Expected-versus-actual for one step, the responsible control, and the persisted evidence. */
export function StepDetail({ step }: { step: StepView }) {
  const e = step.expected as Expected;
  const a = step.actual as Actual;
  const rows: Array<[string, string, string]> = [
    ["Final decision", list(e.decision), dash(a.finalDecision)],
    ["Capability", dash(e.capability), dash(a.capability)],
    ["Execution", dash(e.execution), dash(a.execution)],
    ["Result / error code", list(e.resultCodes), dash(a.resultCode)],
    [
      "Responsible control",
      list(e.control?.map((c) => CONTROL_LABEL[c] ?? c)),
      CONTROL_LABEL[step.control ?? "none"] ?? "—",
    ],
  ];
  if (e.executedAtMost !== undefined || e.executedExactly !== undefined)
    rows.push([
      "Executed (parallel)",
      String(e.executedExactly ?? `≤ ${e.executedAtMost}`),
      dash(a.executedCount),
    ]);
  if (e.replayed !== undefined) rows.push(["Replay detected", String(e.replayed), dash(a.replayed)]);

  const req = step.request as {
    tool?: string;
    operation?: string;
    resource?: string | null;
    arguments?: Record<string, unknown>;
    argumentAudit?: Record<string, unknown>;
  } | null;
  const audit = req?.argumentAudit ?? req?.arguments ?? null;

  return (
    <div className="flex flex-col gap-space-md rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-headline-sm text-headline-sm text-on-surface">{step.label}</h4>
        <span
          className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${VERDICT_CLASS[step.verdict]}`}
        >
          {step.verdict}
        </span>
        <span className="font-mono-code text-[11px] text-outline">
          {step.kind} · {step.action}
          {step.latencyMs !== null ? ` · ${step.latencyMs} ms` : ""}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse font-body-sm text-body-sm">
          <caption className="sr-only">Expected versus actual outcome</caption>
          <thead>
            <tr className="text-left text-on-surface-variant">
              <th className="py-1 pr-3 font-medium">Aspect</th>
              <th className="py-1 pr-3 font-medium">Expected</th>
              <th className="py-1 font-medium">Actual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, x, y]) => (
              <tr key={k} className="border-t border-outline-variant/20">
                <td className="py-1.5 pr-3 text-on-surface-variant">{k}</td>
                <td className="py-1.5 pr-3 font-mono-code text-[12px]">{x}</td>
                <td className="py-1.5 font-mono-code text-[12px] text-on-surface">{y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {step.mismatches.length > 0 ? (
        <ul className="list-disc rounded-lg border border-deny/30 bg-deny/5 py-2 pl-7 pr-3 font-body-sm text-body-sm text-deny">
          {step.mismatches.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-space-md md:grid-cols-2">
        <div>
          <div className="font-body-sm text-body-sm text-on-surface-variant">Evidence: gateway reasons</div>
          <div className="font-mono-code text-[12px] text-on-surface">
            {a.reasonCodes?.length ? a.reasonCodes.join(", ") : "none reported"}
          </div>
          {a.deterministicDecision ? (
            <div className="mt-1 font-mono-code text-[12px] text-outline">
              deterministic: {a.deterministicDecision} → final: {dash(a.finalDecision)}
            </div>
          ) : null}
        </div>
        <div>
          <div className="font-body-sm text-body-sm text-on-surface-variant">Evidence: semantic review</div>
          {a.semantic ? (
            <div className="font-mono-code text-[12px] text-on-surface">
              {a.semantic.state ?? "—"} · risk {a.semantic.risk ?? "—"}
              {a.semantic.narrowed ? " · narrowed the decision" : ""}
              {a.semantic.indicators.length ? ` · ${a.semantic.indicators.join(", ")}` : ""}
            </div>
          ) : (
            <div className="font-mono-code text-[12px] text-outline">not consulted for this step</div>
          )}
        </div>
      </div>

      {req ? (
        <div>
          <div className="font-body-sm text-body-sm text-on-surface-variant">
            Request (values hidden; keys and types only)
          </div>
          <div className="font-mono-code text-[12px] text-on-surface">
            {dash(req.tool)}
            {req.operation ? ` · ${req.operation}` : ""}
            {req.resource ? ` · ${req.resource}` : ""}
          </div>
          {audit ? (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-container-low p-2 font-mono-code text-[11px] text-on-surface-variant">
              {JSON.stringify(audit, null, 1)}
            </pre>
          ) : null}
        </div>
      ) : null}

      {(() => {
        const inj = (step.evidence as { injected?: { source: string; text: string } | null } | null)
          ?.injected;
        return inj ? (
          <div className="rounded-lg border border-secondary/30 bg-secondary/5 p-space-md">
            <div className="font-body-sm text-body-sm text-secondary">
              Injected input ({inj.source.replace("_", " ")}, synthetic)
            </div>
            <div className="font-mono-code text-[12px] text-on-surface">{inj.text}</div>
          </div>
        ) : null;
      })()}

      {a.guidance ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-space-md font-body-sm text-body-sm text-on-surface">
          <span className="font-medium text-primary">Agent recovery guidance ({a.guidance.nextStep}):</span>{" "}
          {a.guidance.message}
        </div>
      ) : null}
    </div>
  );
}
