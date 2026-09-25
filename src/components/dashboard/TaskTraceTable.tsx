"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import type { TaskTrace } from "@/lib/data/dashboard";
import type { TaskStatus } from "@/lib/domain";

const STATUS_CLASSES: Record<TaskStatus, string> = {
  pending: "border-outline-variant/40 text-on-surface-variant",
  contract_issued: "border-primary/30 text-primary",
  executing: "border-primary/30 text-primary-container",
  awaiting_approval: "border-amber-400/40 text-amber-300",
  completed: "border-allow/30 text-allow",
  failed: "border-deny/40 text-deny",
  terminated: "border-deny/40 text-deny",
};

function taskHref(taskId: string): string {
  return `/app/tasks/${taskId}`;
}

function TaskRow({ trace }: { trace: TaskTrace }) {
  const router = useRouter();
  const { task, agentName, principalName, decisionCount, blockedCount } = trace;
  const href = taskHref(task.id);

  return (
    <tr
      onClick={() => router.push(href)}
      className="group cursor-pointer border-b border-outline-variant/20 transition-colors last:border-b-0 hover:bg-surface-container-high focus-within:bg-surface-container-high"
    >
      <td className="px-space-lg py-space-md">
        <Link
          href={href}
          className="rounded font-mono-code text-[12px] text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
        >
          {task.id}
        </Link>
        <p className="mt-0.5 max-w-xs truncate font-body-sm text-body-sm text-on-surface-variant">
          {task.intent}
        </p>
      </td>
      <td className="px-space-lg py-space-md font-mono-code text-[12px] text-on-surface">{agentName}</td>
      <td className="px-space-lg py-space-md font-body-sm text-body-sm text-on-surface-variant">
        {principalName}
      </td>
      <td className="px-space-lg py-space-md">
        <span
          className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_CLASSES[task.status]}`}
        >
          {task.status.replace(/_/g, " ")}
        </span>
      </td>
      <td className="whitespace-nowrap px-space-lg py-space-md font-mono-code text-[11px] text-on-surface-variant">
        {new Date(task.createdAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </td>
      <td className="px-space-lg py-space-md font-mono-code text-[12px] text-on-surface">{decisionCount}</td>
      <td
        className={`px-space-lg py-space-md font-mono-code text-[12px] ${
          blockedCount > 0 ? "font-semibold text-deny" : "text-outline"
        }`}
      >
        {blockedCount}
      </td>
      <td className="w-10 px-space-md py-space-md text-outline transition-colors group-hover:text-on-surface-variant">
        <Icon name="arrow_forward" size={15} />
      </td>
    </tr>
  );
}

/** Recent task traces. Every row is clickable and opens its investigation view. */
export function TaskTraceTable({ traces }: { traces: TaskTrace[] }) {
  return (
    <div className="max-h-[560px] overflow-auto rounded-xl border border-outline-variant/30 bg-surface-container">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <caption className="sr-only">Recent task traces, each row opens its task</caption>
        <thead className="sticky top-0 z-10 bg-surface-container">
          <tr className="border-b border-outline-variant/30">
            {["Task", "Agent", "Principal", "Status", "Created", "Decisions", "Blocked", ""].map(
              (heading) => (
                <th
                  key={heading || "affordance"}
                  scope="col"
                  className="whitespace-nowrap px-space-lg py-space-md font-label-caps text-label-caps uppercase tracking-widest text-outline"
                >
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => (
            <TaskRow key={trace.task.id} trace={trace} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
