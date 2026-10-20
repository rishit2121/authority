"use client";

import { useState, useTransition } from "react";

import { setCustomOperationAutoExecuteAction } from "@/app/app/alignment/actions";

export interface AutoExecuteOperation {
  id: string;
  toolName: string;
  name: string;
  effect: string;
  enabled: boolean;
}

export interface AutoExecuteAuditEntry {
  at: string;
  toolName: string;
  action: string;
  note: string | null;
}

/**
 * Per-application opt-in for published Custom API writes. By default every Custom API write call is held for
 * a person; opting an operation in lifts only that default for this application's tasks. Approval rules,
 * task alignment, contracts, pinned values, budgets and task sessions still apply.
 */
export function CustomApiAutoExecutePanel({
  applicationId,
  operations,
  audit,
  canEdit,
}: {
  applicationId: string;
  operations: AutoExecuteOperation[];
  audit: AutoExecuteAuditEntry[];
  canEdit: boolean;
}) {
  const [state, setState] = useState(() => Object.fromEntries(operations.map((o) => [o.id, o.enabled])));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <section
      className="rounded-[12px] border border-line bg-paper-raised p-5"
      data-testid="custom-api-auto-execute"
    >
      <h2 className="text-[15px] font-semibold text-ink">Custom API automatic execution</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
        Every published Custom API write (POST, PUT, PATCH, DELETE) is held for a person on each call by
        default. Turn one on here to let this application&apos;s agents run it without that hold. It still has
        to be in the task&apos;s contract with the pinned values and budget, and approval rules, task
        alignment and task sessions still apply. Each change is recorded below.{" "}
        <a href="/docs/connectors/custom-api#approval" className="underline underline-offset-2">
          How approval works
        </a>
      </p>
      {operations.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-soft">No published Custom API write operations yet.</p>
      ) : (
        <>
          <label className="mt-3 block text-[13px] text-ink-soft">
            Reason for the change (recorded in the audit trail)
            <input
              value={note}
              maxLength={500}
              disabled={!canEdit || pending}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full max-w-xl rounded-md border border-line bg-paper px-2 py-1 text-[13px] text-ink"
            />
          </label>
          <ul className="mt-3 flex flex-col gap-2">
            {operations.map((o) => (
              <li key={o.id}>
                <label className="flex items-center gap-2 text-[14px] text-ink">
                  <input
                    type="checkbox"
                    checked={state[o.id] ?? false}
                    disabled={!canEdit || pending}
                    data-testid={`auto-execute-${o.toolName}`}
                    onChange={(e) => {
                      const next = e.target.checked;
                      start(async () => {
                        const r = await setCustomOperationAutoExecuteAction(applicationId, o.id, next, note);
                        if (r.ok) setState((s) => ({ ...s, [o.id]: next }));
                        setMessage(
                          r.ok
                            ? { ok: true, text: "Saved." }
                            : { ok: false, text: r.error ?? "Could not save." },
                        );
                      });
                    }}
                  />
                  <span>
                    {o.name} <code className="text-[12px] text-ink-soft">{o.toolName}</code>{" "}
                    <span className="text-[12px] text-ink-soft">({o.effect})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`mt-1 text-[13px] ${message.ok ? "text-allow" : "text-deny"}`}
        >
          {message.text}
        </p>
      ) : null}
      {audit.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] text-ink-soft">Audit trail ({audit.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-[12px] text-ink-soft">
            {audit.map((a, i) => (
              <li key={i}>
                {new Date(a.at).toISOString().replace("T", " ").slice(0, 19)} UTC · {a.action} ·{" "}
                <code>{a.toolName}</code>
                {a.note ? ` · ${a.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
