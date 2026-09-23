import { EmptyWorkspace } from "@/components/dashboard/EmptyWorkspace";
import { DemoDataNotice } from "@/components/dashboard/DemoDataNotice";
import { Icon } from "@/components/ui/Icon";
import { TENANT_ROLE_LABELS } from "@/lib/auth/tenant-context";
import type { AgentStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const STATUS_CLASSES: Record<AgentStatus, string> = {
  active: "border-allow/30 bg-allow/10 text-allow",
  paused: "border-secondary/40 bg-secondary/10 text-secondary",
  revoked: "border-deny/40 bg-deny/10 text-deny",
};

export default async function AgentsPage() {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/agents");

  const [agents, principals] = await Promise.all([
    repositories.agents.listByTenant(identity.tenant.tenantId),
    repositories.principals.listByTenant(identity.tenant.tenantId),
  ]);

  const ownerName = (id: string) => principals.find((p) => p.id === id)?.displayName ?? "unknown";
  const canManageDemoData = identity.role !== "viewer" && TENANT_ROLE_LABELS[identity.role] !== undefined;

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Agents
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Registered agents, their owning principals, and the models and frameworks they run on. Authority
          never runs an agent — this records identity so decisions and capabilities can be attributed.
        </p>
      </header>

      <p className="font-body-sm text-body-sm text-outline">
        Environment and risk tier are recorded in the database but not yet part of the domain model this view
        reads from — showing them here would mean widening a schema kept deliberately narrow for the
        authorization path. They&apos;ll surface once a product need reads them, not before.
      </p>

      {agents.length === 0 ? (
        <EmptyWorkspace />
      ) : (
        <>
          <DemoDataNotice showReset={canManageDemoData} />

          <div className="overflow-auto rounded-xl border border-outline-variant/30 bg-surface-container">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <caption className="sr-only">Registered agents in this workspace</caption>
              <thead>
                <tr className="border-b border-outline-variant/30">
                  {["Name", "Model", "Status", "Owner", "Created"].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="whitespace-nowrap px-space-lg py-space-md font-label-caps text-label-caps uppercase tracking-widest text-outline"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr
                    key={agent.id}
                    className="border-b border-outline-variant/20 last:border-b-0 hover:bg-surface-container-high"
                  >
                    <td className="px-space-lg py-space-md">
                      <span className="flex items-center gap-2 font-mono-code text-[12px] text-on-surface">
                        <Icon name="smart_toy" size={14} className="text-outline" />
                        {agent.name}
                      </span>
                    </td>
                    <td className="px-space-lg py-space-md font-body-sm text-body-sm text-on-surface-variant">
                      {agent.model}
                      <span className="ml-1 text-outline">· {agent.framework}</span>
                    </td>
                    <td className="px-space-lg py-space-md">
                      <span
                        className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_CLASSES[agent.status]}`}
                      >
                        {agent.status}
                      </span>
                    </td>
                    <td className="px-space-lg py-space-md font-body-sm text-body-sm text-on-surface-variant">
                      {ownerName(agent.ownerPrincipalId)}
                    </td>
                    <td className="whitespace-nowrap px-space-lg py-space-md font-mono-code text-[11px] text-outline">
                      {new Date(agent.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
