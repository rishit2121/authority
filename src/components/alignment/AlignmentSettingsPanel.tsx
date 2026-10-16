"use client";

import { useState, useTransition } from "react";

import { setAlignmentChecksAction, setAlignmentSettingsAction } from "@/app/app/alignment/actions";

const MODES: [string, string, string][] = [
  ["off", "Off", "Nothing is reviewed. Tasks behave exactly as before."],
  [
    "shadow",
    "Shadow",
    "Plans and content are reviewed and findings recorded, but nothing is held or blocked.",
  ],
  [
    "enforce",
    "Enforce",
    "Misaligned plans need a revision, held content is withheld, and a raw runtime key is refused.",
  ],
];

const field =
  "rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink focus:border-signal focus:outline-none disabled:opacity-60";

/** Per-application switch for task alignment (off by default). */
export function AlignmentSettingsPanel({
  applicationId,
  initialMode,
  initialPolicy,
  initialChecks,
  canEdit,
}: {
  applicationId: string;
  initialMode: string;
  initialPolicy: string;
  initialChecks: {
    plans: boolean;
    content: boolean;
    actions: boolean;
    contentAction: "report" | "quarantine";
  };
  canEdit: boolean;
}) {
  const [checks, setChecks] = useState(initialChecks);
  const [mode, setMode] = useState(initialMode);
  const [policy, setPolicy] = useState(initialPolicy);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <section
      className="rounded-[12px] border border-line bg-paper-raised p-5"
      data-testid="alignment-settings"
    >
      <h2 className="text-[15px] font-semibold text-ink">Task alignment</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
        Checks that each plan and its values serve what the user asked for, and screens external content your
        app sends through Authority for instructions aimed at the agent. Based on Task Shield; findings are
        model judgments, not guarantees.{" "}
        <a href="/docs/task-alignment" className="underline underline-offset-2">
          How these settings work
        </a>
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
          Mode
          <select
            value={mode}
            disabled={!canEdit}
            onChange={(e) => setMode(e.target.value)}
            className={field}
            data-testid="alignment-mode"
          >
            {MODES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
          Policy
          <select
            value={policy}
            disabled={!canEdit}
            onChange={(e) => setPolicy(e.target.value)}
            className={field}
            data-testid="alignment-policy"
          >
            <option value="production">Production (value checks, quarantine, review holds)</option>
            <option value="reference">Reference (Task Shield as published, for evaluation)</option>
          </select>
        </label>
        {canEdit ? (
          <button
            type="button"
            disabled={pending}
            data-testid="alignment-save"
            onClick={() =>
              start(async () => {
                const r = await setAlignmentSettingsAction(applicationId, mode, policy);
                const c = r.ok ? await setAlignmentChecksAction(applicationId, checks) : r;
                if (!c.ok) return setMessage({ ok: false, text: c.error ?? "Could not save." });
                setMessage(
                  r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error ?? "Could not save." },
                );
              })
            }
            className="h-[38px] rounded-lg bg-primary px-4 text-[14px] font-medium text-on-primary hover:bg-primary-fixed disabled:opacity-70"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[13px] text-ink-soft">{MODES.find(([v]) => v === mode)?.[2]}</p>
      <fieldset className="mt-3 flex flex-col gap-2 text-[13px] text-ink">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={checks.plans}
            onChange={(e) => setChecks({ ...checks, plans: e.target.checked })}
            data-testid="alignment-check-plans"
          />
          Plans and values at prepare
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={checks.actions}
            onChange={(e) => setChecks({ ...checks, actions: e.target.checked })}
            data-testid="alignment-check-actions"
          />
          Each tool call at authorization
        </label>
        <label className="flex flex-wrap items-center gap-1.5">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={checks.content}
            onChange={(e) => setChecks({ ...checks, content: e.target.checked })}
            data-testid="alignment-check-content"
          />
          Optional: screen external content your app submits, and Authority&apos;s connector results
          <select
            value={checks.contentAction}
            disabled={!canEdit || !checks.content}
            onChange={(e) =>
              setChecks({ ...checks, contentAction: e.target.value as "report" | "quarantine" })
            }
            className="ml-1 rounded-md border border-line-strong bg-paper px-2 py-1 text-[13px]"
            data-testid="alignment-content-action"
          >
            <option value="report">report findings only</option>
            <option value="quarantine">quarantine flagged content</option>
          </select>
        </label>
        <span className="text-[12px] text-ink-soft">
          Plan and call checks never depend on content screening. Content that was not screened is reported as
          &ldquo;not inspected&rdquo;, never as passed. Task sessions are set separately above.
        </span>
      </fieldset>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`mt-1 text-[13px] ${message.ok ? "text-allow" : "text-deny"}`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
