import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TaskInvestigationView } from "@/components/task/TaskInvestigationView";
import { loadTaskInvestigation } from "@/lib/data/task";

export const metadata: Metadata = {
  title: "Task #1842 · GitHub issue #991",
};

export default async function DemoTaskPage() {
  const investigation = await loadTaskInvestigation("task_1842");
  if (!investigation) notFound();

  return <TaskInvestigationView investigation={investigation} />;
}
