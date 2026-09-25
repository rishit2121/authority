import type { Metadata } from "next";

import { NewTaskForm } from "@/components/task/NewTaskForm";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = {
  title: "New task",
};

export default async function NewTaskPage() {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/tasks/new");

  const [agents, principals] = await Promise.all([
    repositories.agents.listByTenant(identity.tenant.tenantId),
    repositories.principals.listByTenant(identity.tenant.tenantId),
  ]);

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          New task
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Record a trusted objective for an existing agent and principal in this workspace.
        </p>
      </header>

      <NewTaskForm agents={agents} principals={principals} />
    </div>
  );
}
