"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TaskStatus } from "@/lib/domain";

const STATUS_OPTIONS: { value: TaskStatus | ""; label: string }[] = [
  { value: "", label: "Any status" },
  { value: "pending", label: "Pending" },
  { value: "contract_issued", label: "Contract issued" },
  { value: "executing", label: "Executing" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "terminated", label: "Terminated" },
];

const selectClass =
  "h-9 rounded-lg border border-line-strong bg-paper px-2.5 text-[13px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * The Tasks list's three visible filters — Status, Agent, Search — each
 * change navigates to the first page with the new query string; no "More
 * filters" overflow is needed because the list never exceeds these three.
 */
export function TaskFilters({
  agents,
  status,
  agentId,
  search,
}: {
  agents: { id: string; name: string }[];
  status: string;
  agentId: string;
  search: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(search);

  const navigate = (next: { status?: string; agentId?: string; search?: string }) => {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextAgent = next.agentId ?? agentId;
    const nextSearch = next.search ?? search;
    if (nextStatus) params.set("status", nextStatus);
    if (nextAgent) params.set("agent", nextAgent);
    if (nextSearch) params.set("q", nextSearch);
    router.push(params.size > 0 ? `/app/tasks?${params.toString()}` : "/app/tasks");
  };

  return (
    <form
      role="search"
      aria-label="Filter tasks"
      onSubmit={(event) => {
        event.preventDefault();
        navigate({ search: query });
      }}
      className="flex flex-wrap items-center gap-2.5"
    >
      <select
        aria-label="Status"
        className={selectClass}
        value={status}
        onChange={(event) => navigate({ status: event.target.value })}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Agent"
        className={selectClass}
        value={agentId}
        onChange={(event) => navigate({ agentId: event.target.value })}
      >
        <option value="">Any agent</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Search tasks"
        placeholder="Search tasks…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-9 w-48 rounded-lg border border-line-strong bg-paper px-2.5 text-[13px] text-ink placeholder:text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
    </form>
  );
}
