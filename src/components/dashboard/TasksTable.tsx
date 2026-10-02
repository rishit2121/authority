"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { NO_CONTRACT_LABEL, presentContractStatus } from "@/lib/authorization/contract-status";
import type { Task, TaskAuthorityContract, TaskStatus } from "@/lib/domain";

export interface TaskRow {
  task: Task;
  agentName: string;
  contract: TaskAuthorityContract | null;
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  contract_issued: "Contract issued",
  executing: "Executing",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  terminated: "Terminated",
};

const TASK_STATUS_TONE: Record<TaskStatus, StatusTone> = {
  pending: "neutral",
  contract_issued: "neutral",
  executing: "executing",
  awaiting_approval: "attention",
  completed: "positive",
  failed: "negative",
  terminated: "negative",
};

const CONTRACT_TONE: Record<ReturnType<typeof presentContractStatus>["tone"], StatusTone> = {
  positive: "positive",
  attention: "attention",
  negative: "negative",
  neutral: "neutral",
};

function lastActivity(task: Task): string {
  const latest = task.completedAt ?? task.createdAt;
  return new Date(latest).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TaskTableRow({ row }: { row: TaskRow }) {
  const router = useRouter();
  const href = `/app/tasks/${row.task.id}`;

  return (
    <tr
      onClick={() => router.push(href)}
      className="group cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-black/[0.02] focus-within:bg-black/[0.02]"
    >
      <td className="px-4 py-3">
        <Link
          href={href}
          className="block max-w-sm truncate text-[14px] text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {row.task.intent}
        </Link>
        <p className="mt-0.5 font-mono-code text-[11px] text-ink-soft">{row.task.id}</p>
      </td>
      <td className="px-4 py-3 text-[13px] text-ink">{row.agentName}</td>
      <td className="px-4 py-3">
        <StatusPill
          tone={row.contract ? CONTRACT_TONE[presentContractStatus(row.contract.status).tone] : "muted"}
        >
          {row.contract ? presentContractStatus(row.contract.status).label : NO_CONTRACT_LABEL}
        </StatusPill>
      </td>
      <td className="px-4 py-3">
        <StatusPill tone={TASK_STATUS_TONE[row.task.status]}>{TASK_STATUS_LABEL[row.task.status]}</StatusPill>
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-mono-code text-[11px] text-ink-soft">
        {lastActivity(row.task)}
      </td>
      <td className="w-8 px-3 py-3 text-ink-soft transition-colors group-hover:text-ink">
        <Icon name="arrow_forward" size={15} />
      </td>
    </tr>
  );
}

/** The tenant's tasks: title and ID, agent, contract state, task state, and when it last moved. Every row opens its investigation view. */
export function TasksTable({ rows }: { rows: TaskRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-paper-raised">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <caption className="sr-only">Tasks, each row opens its investigation view</caption>
        <thead>
          <tr className="border-b border-line">
            {["Task", "Agent", "Contract", "Status", "Last activity", ""].map((heading) => (
              <th
                key={heading || "affordance"}
                scope="col"
                className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-soft"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TaskTableRow key={row.task.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
