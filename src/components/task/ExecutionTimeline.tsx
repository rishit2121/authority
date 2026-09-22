import type { ExecutionEvent, ExecutionOutcome } from "@/lib/domain";

import { Panel } from "./panels";

const OUTCOME_DOT: Record<ExecutionOutcome, string> = {
  success: "bg-allow",
  blocked: "bg-deny",
  failure: "bg-deny",
  info: "bg-primary-container",
};

const OUTCOME_TEXT: Record<ExecutionOutcome, string> = {
  success: "text-allow",
  blocked: "text-deny",
  failure: "text-deny",
  info: "text-primary",
};

function formatTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19) + "Z";
}

/** Append-only audit trace: what was asked, decided and actually run. */
export function ExecutionTimeline({ events }: { events: ExecutionEvent[] }) {
  return (
    <Panel id="timeline" title="Execution timeline" subtitle={`${events.length} recorded events`}>
      <ol className="relative space-y-space-md border-l border-outline-variant/30 pl-space-lg">
        {events.map((event) => (
          <li key={event.id} className="relative">
            <span
              className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${OUTCOME_DOT[event.outcome]}`}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={`font-mono-code text-[11px] uppercase ${OUTCOME_TEXT[event.outcome]}`}>
                {event.type.replace(/_/g, " ")}
              </span>
              <span className="font-mono-code text-[11px] text-outline">{formatTime(event.occurredAt)}</span>
            </div>
            <p className="mt-0.5 font-body-md text-body-md text-on-surface">{event.summary}</p>
            {event.detail ? (
              <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{event.detail}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
