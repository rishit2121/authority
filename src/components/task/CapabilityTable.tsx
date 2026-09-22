import type { Capability, CapabilityStatus } from "@/lib/domain";

import { Panel } from "./panels";

const STATUS_CLASSES: Record<CapabilityStatus, string> = {
  active: "border-allow/35 bg-allow/10 text-allow",
  consumed: "border-primary/30 bg-primary/10 text-primary",
  expired: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
  revoked: "border-deny/35 bg-deny/10 text-deny",
};

function formatTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19) + "Z";
}

/** Temporary permissions issued for this task, live and spent alike. */
export function CapabilityTable({ capabilities }: { capabilities: Capability[] }) {
  const active = capabilities.filter((c) => c.status === "active").length;

  return (
    <Panel
      id="capabilities"
      title="Capabilities"
      subtitle={`${active} active · ${capabilities.length - active} expired, consumed or revoked · 0 standing permissions`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <caption className="sr-only">Capabilities issued for this task</caption>
          <thead>
            <tr className="border-b border-outline-variant/30">
              {["Capability", "Constraints", "Uses", "Issued", "Expires", "Status"].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-space-md py-space-sm font-label-caps text-label-caps uppercase tracking-widest text-outline"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {capabilities.map((capability) => (
              <tr key={capability.id} className="border-b border-outline-variant/20 last:border-b-0">
                <td className="px-space-md py-space-md font-mono-code text-[12px] text-on-surface">
                  {capability.tool}
                </td>
                <td className="px-space-md py-space-md font-mono-code text-[11px] text-on-surface-variant">
                  {capability.constraints.length === 0
                    ? "—"
                    : capability.constraints
                        .map((c) =>
                          c.equals !== undefined ? `${c.key} = ${c.equals}` : `${c.key} ~ ${c.matches}`,
                        )
                        .join(" · ")}
                </td>
                <td className="px-space-md py-space-md font-mono-code text-[11px] text-on-surface-variant">
                  {capability.usedInvocations}/{capability.maxInvocations}
                </td>
                <td className="px-space-md py-space-md font-mono-code text-[11px] text-outline">
                  {formatTime(capability.issuedAt)}
                </td>
                <td className="px-space-md py-space-md font-mono-code text-[11px] text-outline">
                  {formatTime(capability.expiresAt)}
                </td>
                <td className="px-space-md py-space-md">
                  <span
                    className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_CLASSES[capability.status]}`}
                  >
                    {capability.status}
                  </span>
                  {capability.revocationReason ? (
                    <span className="mt-1 block font-mono-code text-[10px] text-outline">
                      {capability.revocationReason}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
