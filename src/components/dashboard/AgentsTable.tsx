import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import type { CredentialStatus } from "@/lib/data/agents";
import type { Agent, AgentStatus } from "@/lib/domain";

export interface AgentRow {
  agent: Agent;
  ownerName: string;
  credentialStatus: CredentialStatus;
  protectedCalls: number;
  lastSeen: string | null;
}

const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  active: "Active",
  paused: "Paused",
  revoked: "Revoked",
};

const AGENT_STATUS_TONE: Record<AgentStatus, StatusTone> = {
  active: "positive",
  paused: "attention",
  revoked: "negative",
};

const CREDENTIAL_LABEL: Record<CredentialStatus, string> = {
  configured: "Configured",
  not_configured: "Not configured",
};

const CREDENTIAL_TONE: Record<CredentialStatus, StatusTone> = {
  configured: "positive",
  not_configured: "muted",
};

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return "Never";
  return new Date(lastSeen).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Agent status (operational — active/paused/revoked) and credential status
 * (whether a runtime secret exists) are rendered as two separate pills,
 * deliberately never merged into one, because an agent can be active with no
 * credential yet, or revoked while a credential still technically exists.
 */
export function AgentsTable({ rows }: { rows: AgentRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-paper-raised">
      <table className="w-full min-w-[860px] border-collapse text-left">
        <caption className="sr-only">Registered agents in this workspace</caption>
        <thead>
          <tr className="border-b border-line">
            {["Agent", "Status", "Credentials", "Protected calls", "Last seen", "Owner"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-soft"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ agent, ownerName, credentialStatus, protectedCalls, lastSeen }) => (
            <tr
              key={agent.id}
              className="border-b border-line transition-colors last:border-b-0 hover:bg-black/[0.02]"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/app/agents/${agent.id}`}
                  className="flex items-center gap-2 text-[14px] text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Icon name="smart_toy" size={15} className="text-ink-soft" />
                  {agent.name}
                </Link>
                <p className="mt-0.5 pl-[23px] text-[12px] text-ink-soft">
                  {agent.model} · {agent.framework}
                </p>
              </td>
              <td className="px-4 py-3">
                <StatusPill tone={AGENT_STATUS_TONE[agent.status]}>
                  {AGENT_STATUS_LABEL[agent.status]}
                </StatusPill>
              </td>
              <td className="px-4 py-3">
                <StatusPill tone={CREDENTIAL_TONE[credentialStatus]}>
                  {CREDENTIAL_LABEL[credentialStatus]}
                </StatusPill>
              </td>
              <td className="px-4 py-3 font-mono-code text-[12px] text-ink">{protectedCalls}</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono-code text-[11px] text-ink-soft">
                {formatLastSeen(lastSeen)}
              </td>
              <td className="px-4 py-3 text-[13px] text-ink-soft">{ownerName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
