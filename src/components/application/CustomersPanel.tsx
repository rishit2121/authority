import { StatusPill } from "@/components/ui/StatusPill";

export interface CustomerConnectionSummary {
  connectorId: string;
  status: string;
  verifiedAccountRef: string | null;
}

export interface CustomerRow {
  id: string;
  externalId: string;
  displayLabel: string | null;
  status: string;
  createdAt: string;
  connections: CustomerConnectionSummary[];
}

/** Read-only: customers are created only through the developer API, by the application's own backend. */
export function CustomersPanel({ customers }: { customers: CustomerRow[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-paper-raised p-5">
      <h2 className="text-[15px] font-semibold text-ink">Customers</h2>
      <p className="text-[13px] text-ink-soft">
        Created only by this application&apos;s own backend, through{" "}
        <code className="font-mono-code">POST /api/v1/customers</code> — never here, and never given a
        dashboard login.
      </p>
      {customers.length === 0 ? (
        <p className="text-[13px] text-ink-soft">No customers yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {customers.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-1.5 rounded-lg border border-line bg-paper p-3.5"
              data-testid={`customer-${c.externalId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-code text-[12px] text-ink">{c.displayLabel ?? c.externalId}</span>
                <StatusPill tone={c.status === "active" ? "positive" : "muted"}>{c.status}</StatusPill>
              </div>
              <p className="text-[11px] text-ink-soft">
                external id <code className="font-mono-code">{c.externalId}</code> · since{" "}
                {new Date(c.createdAt).toLocaleDateString()}
              </p>
              {c.connections.length === 0 ? (
                <p className="text-[12px] text-ink-soft">No connections yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {c.connections.map((conn, i) => (
                    <li
                      key={i}
                      className="rounded border border-line px-1.5 py-0.5 font-mono-code text-[11px] text-ink-soft"
                    >
                      {conn.connectorId}
                      {conn.verifiedAccountRef ? ` · ${conn.verifiedAccountRef}` : ""} ({conn.status})
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
