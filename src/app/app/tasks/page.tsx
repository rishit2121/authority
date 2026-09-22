import { TaskTraceTable } from "@/components/dashboard/TaskTraceTable";
import { loadDashboardOverview } from "@/lib/data/dashboard";

export default async function TasksPage() {
  const { traces } = await loadDashboardOverview();

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Tasks
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Every delegated task and the authority it received. Only the GitHub #991 task has a full
          investigation view in this build.
        </p>
      </header>
      <TaskTraceTable traces={traces} />
    </div>
  );
}
