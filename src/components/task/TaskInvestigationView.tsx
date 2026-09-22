"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type { TaskInvestigation } from "@/lib/data/task";
import type { Capability, ExecutionEvent } from "@/lib/domain";

import { BoundarySummary } from "./BoundarySummary";
import { CapabilityTable } from "./CapabilityTable";
import { ContractPanel } from "./ContractPanel";
import { DecisionEvidence } from "./DecisionEvidence";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { KillSwitch } from "./KillSwitch";
import { PlanTable } from "./PlanTable";
import { Field, Panel } from "./panels";

/**
 * The task investigation view.
 *
 * Client-side because the kill switch mutates what is displayed: the task
 * status, every live capability, and the execution timeline. In this build
 * that mutation is local state — nothing is persisted or sent anywhere.
 */
export function TaskInvestigationView({ investigation }: { investigation: TaskInvestigation }) {
  const { task, agent, principal, contract, plan, toolRequests, decisions, events, capabilities } =
    investigation;

  const [terminated, setTerminated] = useState(false);

  const activeCount = useMemo(() => capabilities.filter((c) => c.status === "active").length, [capabilities]);

  const shownCapabilities: Capability[] = useMemo(() => {
    if (!terminated) return capabilities;
    const revokedAt = new Date().toISOString();
    return capabilities.map((capability) =>
      capability.status === "active"
        ? { ...capability, status: "revoked", revokedAt, revocationReason: "Kill switch" }
        : capability,
    );
  }, [capabilities, terminated]);

  const shownEvents: ExecutionEvent[] = useMemo(() => {
    if (!terminated) return events;
    const killEvent: ExecutionEvent = {
      id: "evt_kill_switch",
      tenantId: task.tenantId,
      taskId: task.id,
      type: "task_terminated",
      outcome: "blocked",
      summary: `Kill switch engaged — ${activeCount} capabilities revoked, 0 standing permissions remain.`,
      detail:
        "Operator terminated the task from the control plane. Mocked action; no external call was made.",
      occurredAt: new Date().toISOString(),
    };
    return [...events, killEvent];
  }, [events, terminated, task.tenantId, task.id, activeCount]);

  const status = terminated ? "terminated" : task.status;

  return (
    <div className="flex flex-col gap-space-xl">
      <header className="flex flex-col gap-space-md">
        <Link
          href="/app"
          className="inline-flex w-fit items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Icon name="arrow_forward" size={14} className="rotate-180" />
          Back to overview
        </Link>

        <div className="flex flex-wrap items-center gap-space-md">
          <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono-code text-[12px] text-primary">
            {task.id}
          </span>
          <span
            className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${
              terminated ? "border-deny/40 bg-deny/10 text-deny" : "border-allow/30 bg-allow/10 text-allow"
            }`}
          >
            {status.replace(/_/g, " ")}
          </span>
        </div>

        <h1 className="max-w-3xl font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          {task.intent}
        </h1>
        <p className="font-body-sm text-body-sm text-outline">
          Trusted user task. Everything below was derived from this sentence before the agent proposed a plan.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-space-md md:grid-cols-2">
        <Panel id="principal" title="Human principal" subtitle="Authority is always traced back to a person">
          <dl className="grid grid-cols-2 gap-space-md">
            <Field label="Name">{principal.displayName}</Field>
            <Field label="Kind">{principal.kind}</Field>
            <Field label="Email">{principal.email ?? "—"}</Field>
            <Field label="Principal ID">{principal.id}</Field>
          </dl>
        </Panel>

        <Panel id="agent" title="Agent identity" subtitle="Customer-owned; Authority never runs it">
          <dl className="grid grid-cols-2 gap-space-md">
            <Field label="Agent">{agent.name}</Field>
            <Field label="Model">{agent.model}</Field>
            <Field label="Framework">{agent.framework}</Field>
            <Field label="Status">{agent.status}</Field>
          </dl>
        </Panel>
      </div>

      <BoundarySummary />
      <ContractPanel contract={contract} />
      <PlanTable plan={plan} decisions={decisions} toolRequests={toolRequests} />
      <DecisionEvidence decisions={decisions} />
      <CapabilityTable capabilities={shownCapabilities} />
      <ExecutionTimeline events={shownEvents} />

      <KillSwitch
        activeCapabilities={activeCount}
        terminated={terminated}
        onConfirm={() => setTerminated(true)}
      />
    </div>
  );
}
