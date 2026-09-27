import { STATUS_CLASS, SEVERITY_CLASS, humanize } from "./labels";

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 font-mono-code text-[11px] ${
        STATUS_CLASS[status] ?? STATUS_CLASS.skipped
      }`}
    >
      {humanize(status)}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] uppercase ${
        SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.info
      }`}
    >
      {severity}
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <span
      title="Scenarios run against synthetic tenants and mock integrations. Results are not a production guarantee."
      className="inline-flex rounded border border-secondary/40 bg-secondary/10 px-2 py-0.5 font-mono-code text-[11px] uppercase text-secondary"
    >
      synthetic
    </span>
  );
}
