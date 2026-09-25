"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { terminateTaskAction } from "@/app/app/actions";
import { Icon } from "@/components/ui/Icon";
import type { TaskInvestigation } from "@/lib/data/task";

import { BoundarySummary } from "./BoundarySummary";
import { CapabilityTable } from "./CapabilityTable";
import { ContractLifecycleActions } from "./ContractLifecycleActions";
import { ContractPanel } from "./ContractPanel";
import { DecisionEvidence } from "./DecisionEvidence";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { KillSwitch } from "./KillSwitch";
import { PlanTable } from "./PlanTable";
import { Field, Panel } from "./panels";

/** Shown in place of a panel whose underlying record doesn't exist yet. */
function PendingPanel({
  id,
  title,
  message,
  action,
}: {
  id: string;
  title: string;
  message: string;
  action?: { href: string; label: string };
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-space-lg"
    >
      <h2 id={`${id}-heading`} className="font-headline-sm text-headline-sm font-semibold text-on-surface">
        {title}
      </h2>
      <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">{message}</p>
      {action ? (
        <Link
          href={action.href}
          className="mt-space-md inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed"
        >
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}

/**
 * The task investigation view.
 *
 * Client-side because the kill switch triggers a real mutation and needs to
 * show a pending/error state around it. The mutation itself — and every
 * other field on the page — comes entirely from the server-rendered props
 * this component receives; nothing here holds synthetic state standing in
 * for what the database actually contains. After a successful termination
 * `router.refresh()` re-runs the parent Server Component, so what renders
 * next is the real post-termination row, not a client-side guess at it.
 */
export function TaskInvestigationView({ investigation }: { investigation: TaskInvestigation }) {
  const { task, agent, principal, contract, plan, toolRequests, decisions, events, capabilities } =
    investigation;

  const router = useRouter();

  const activeCount = useMemo(() => capabilities.filter((c) => c.status === "active").length, [capabilities]);

  const terminated = task.status === "terminated";

  const handleTerminate = async () => {
    const result = await terminateTaskAction(task.id);
    if (result.ok) {
      router.refresh();
      return { ok: true };
    }
    return { ok: false, error: result.error };
  };

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
            {task.status.replace(/_/g, " ")}
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

      {contract ? (
        <>
          <ContractPanel contract={contract} />
          <ContractLifecycleActions taskId={task.id} contractId={contract.id} status={contract.status} />
          {contract.status === "rejected" ? (
            <PendingPanel
              id="contract-reproposal"
              title="Propose a new contract"
              message="This contract was rejected. Editing the candidate plan and proposing again creates a new version — the rejected one stays exactly as it was."
              action={{ href: `/app/tasks/${task.id}/contract/new`, label: "Create authority contract" }}
            />
          ) : null}
        </>
      ) : (
        <PendingPanel
          id="contract"
          title="Task Authority Contract"
          message="No contract has been proposed for this task yet. Enter a structured candidate plan to compile the minimum authority it needs — proposing one creates no runtime authority by itself."
          action={{ href: `/app/tasks/${task.id}/contract/new`, label: "Create authority contract" }}
        />
      )}

      {plan ? (
        <PlanTable plan={plan} decisions={decisions} toolRequests={toolRequests} />
      ) : (
        <PendingPanel
          id="plan"
          title="Execution plan"
          message="No plan has been proposed for this task yet."
        />
      )}

      <DecisionEvidence decisions={decisions} />
      <CapabilityTable capabilities={capabilities} />
      <ExecutionTimeline events={events} />

      <KillSwitch
        taskId={task.id}
        activeCapabilities={activeCount}
        terminated={terminated}
        onConfirm={handleTerminate}
      />
    </div>
  );
}
