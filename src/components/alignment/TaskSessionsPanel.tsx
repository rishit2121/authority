"use client";

import { useState, useTransition } from "react";

import { setRequireTaskSessionsAction } from "@/app/app/alignment/actions";

/**
 * Task isolation for an application, independent of task alignment: when on,
 * a raw agent runtime key is refused on this application's tasks and agents
 * must open a task session (bound to one task) first.
 */
export function TaskSessionsPanel({
  applicationId,
  initial,
  canEdit,
}: {
  applicationId: string;
  initial: boolean;
  canEdit: boolean;
}) {
  const [required, setRequired] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="rounded-[12px] border border-line bg-paper-raised p-5" data-testid="task-sessions">
      <h2 className="text-[15px] font-semibold text-ink">Require task sessions</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
        An agent&apos;s runtime key works for every task of that agent, across all your customers. With this
        on, the key can only open a task session (<code>agent.sessions.create(&#123; taskId &#125;)</code>),
        and every authorization, tool list and content call must use that session. This does not depend on
        task alignment or any AI review. Turn it on after your agent uses sessions; new applications start
        with it on.
      </p>
      <label className="mt-3 flex items-center gap-2 text-[14px] text-ink">
        <input
          type="checkbox"
          checked={required}
          disabled={!canEdit || pending}
          data-testid="require-task-sessions"
          onChange={(e) => {
            const next = e.target.checked;
            start(async () => {
              const r = await setRequireTaskSessionsAction(applicationId, next);
              if (r.ok) setRequired(next);
              setMessage(
                r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error ?? "Could not save." },
              );
            });
          }}
        />
        Refuse raw runtime keys on this application&apos;s tasks
      </label>
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
