import { HairlineDivider } from "@/components/marketing/HairlineDivider";
import { StatusPill, type StatusTone } from "@/components/marketing/StatusPill";

export interface RuntimeTraceEntry {
  time: string;
  label: string;
  operationId?: string;
  status?: "allowed" | "denied";
  note?: string;
}

const STATUS_LABEL: Record<"allowed" | "denied", string> = {
  allowed: "Allowed",
  denied: "Denied",
};

const STATUS_TONE: Record<"allowed" | "denied", StatusTone> = {
  allowed: "success",
  denied: "denied",
};

/**
 * A simplified, chronological decision trace — human-readable action name
 * first, operation id secondary and small, status always stated as text
 * (never color alone).
 */
export function RuntimeTrace({ entries }: { entries: RuntimeTraceEntry[] }) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => (
        <li key={index}>
          {index > 0 ? <HairlineDivider /> : null}
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-mono-code text-[13px] text-mkt-text-secondary">{entry.time}</span>
              <span className="text-[15px] text-mkt-text">{entry.label}</span>
              {entry.operationId ? (
                <span className="font-mono-code text-[11px] text-mkt-gray">{entry.operationId}</span>
              ) : null}
            </div>
            {entry.status ? (
              <StatusPill tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</StatusPill>
            ) : entry.note ? (
              <span className="text-[13px] text-mkt-text-secondary">{entry.note}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
