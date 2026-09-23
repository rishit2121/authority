import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TaskInvestigationView } from "@/components/task/TaskInvestigationView";
import { loadTaskInvestigation } from "@/lib/data/task";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = {
  title: "Task investigation",
};

/**
 * The dynamic task investigation route.
 *
 * `loadTaskInvestigation` calls `repositories.tasks.findById(taskId)`, which
 * is scoped by this tenant's RLS policies — a task id belonging to another
 * tenant returns no row, indistinguishable from an id that doesn't exist at
 * all. Either way this renders Next's ordinary not-found page, so a stale
 * or guessed task URL from a previous workspace can never reveal that a
 * task exists somewhere else, only that it isn't here.
 */
export default async function TaskInvestigationPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const { repositories } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);

  const investigation = await loadTaskInvestigation(taskId, repositories);
  if (!investigation) notFound();

  return <TaskInvestigationView investigation={investigation} />;
}
