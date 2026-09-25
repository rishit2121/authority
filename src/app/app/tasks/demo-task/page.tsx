import { redirect } from "next/navigation";

import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

/**
 * Legacy URL from Part 1's fixture, kept as a redirect rather than removed:
 * the marketing walkthrough and existing bookmarks/tests link here.
 *
 * Resolves to the installed GitHub #991 demo task by matching its known
 * intent text, since that task's id is now a real generated UUID rather
 * than the fixed `task_1842` Part 1 used. Falls back to the task list when
 * no demo data is installed, rather than a dead link or a raw database
 * error.
 */
export default async function DemoTaskRedirectPage() {
  const { repositories, identity } = await createRepositoriesForCurrentTenant("/app/tasks/demo-task");

  const tasks = await repositories.tasks.listByTenant(identity.tenant.tenantId);
  const demoTask = tasks.find((task) => task.intent.includes("issue #991"));

  redirect(demoTask ? `/app/tasks/${demoTask.id}` : "/app/tasks");
}
