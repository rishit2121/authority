"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createTaskAction, type CreateTaskFormState } from "@/app/app/actions";
import { Icon } from "@/components/ui/Icon";
import type { Agent, Principal } from "@/lib/domain";

const PROVENANCE_OPTIONS = [
  { value: "app_form", label: "Entered directly in the control plane" },
  { value: "ticket_import", label: "Imported from an issue tracker" },
  { value: "api", label: "Submitted via API" },
];

const INITIAL_STATE: CreateTaskFormState = { ok: false };

/**
 * Creates a task via the narrow `create_task()` RPC.
 *
 * This form does not authorize or execute anything. It records a trusted
 * objective and who it's attributed to; the task starts `pending`, with no
 * contract, plan, decision or capability of any kind. Generating a Task
 * Authority Contract from this objective is a later phase.
 */
export function NewTaskForm({ agents, principals }: { agents: Agent[]; principals: Principal[] }) {
  const [state, formAction, pending] = useActionState(createTaskAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.data) {
      router.push(`/app/tasks/${state.data.taskId}`);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-space-lg">
      <div
        role="note"
        className="flex items-start gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5"
      >
        <Icon name="verified_user" size={15} className="mt-0.5 shrink-0 text-outline" />
        <p className="font-body-md text-body-sm text-on-surface-variant">
          Creating a task does not authorize or execute anything. No task contract is generated, no model is
          called, and no external tool runs — this only records the trusted objective and who it&apos;s
          attributed to.
        </p>
      </div>

      {state.error ? (
        <p role="alert" className="font-body-sm text-body-sm text-deny">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-space-xs">
        <label htmlFor="agentId" className="font-body-md text-body-sm font-medium text-on-surface">
          Agent
        </label>
        <select
          id="agentId"
          name="agentId"
          required
          disabled={agents.length === 0}
          aria-describedby={state.fieldErrors?.agentId ? "agentId-error" : undefined}
          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-2.5 font-body-md text-body-md text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container disabled:opacity-60"
        >
          <option value="">Choose an agent…</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.model})
            </option>
          ))}
        </select>
        {state.fieldErrors?.agentId ? (
          <p id="agentId-error" className="font-body-sm text-body-sm text-deny">
            {state.fieldErrors.agentId}
          </p>
        ) : null}
        {agents.length === 0 ? (
          <p className="font-body-sm text-body-sm text-outline">
            No agents exist yet in this workspace. Install demo data or create an agent first.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-space-xs">
        <label htmlFor="principalId" className="font-body-md text-body-sm font-medium text-on-surface">
          Principal
        </label>
        <select
          id="principalId"
          name="principalId"
          required
          disabled={principals.length === 0}
          aria-describedby={state.fieldErrors?.principalId ? "principalId-error" : undefined}
          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-2.5 font-body-md text-body-md text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container disabled:opacity-60"
        >
          <option value="">Choose a principal…</option>
          {principals.map((principal) => (
            <option key={principal.id} value={principal.id}>
              {principal.displayName} ({principal.kind})
            </option>
          ))}
        </select>
        {state.fieldErrors?.principalId ? (
          <p id="principalId-error" className="font-body-sm text-body-sm text-deny">
            {state.fieldErrors.principalId}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-space-xs">
        <label htmlFor="objective" className="font-body-md text-body-sm font-medium text-on-surface">
          Trusted objective
        </label>
        <textarea
          id="objective"
          name="objective"
          required
          rows={3}
          placeholder="Resolve issue #4200 in the billing-service repository and open a pull request."
          aria-describedby={state.fieldErrors?.objective ? "objective-error" : undefined}
          className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-2.5 font-body-md text-body-md text-on-surface placeholder:text-outline/70 focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
        />
        {state.fieldErrors?.objective ? (
          <p id="objective-error" className="font-body-sm text-body-sm text-deny">
            {state.fieldErrors.objective}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-space-xs">
        <label htmlFor="provenance" className="font-body-md text-body-sm font-medium text-on-surface">
          Provenance
        </label>
        <select
          id="provenance"
          name="provenance"
          defaultValue="app_form"
          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-2.5 font-body-md text-body-md text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
        >
          {PROVENANCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={pending || agents.length === 0 || principals.length === 0}
        aria-busy={pending}
        className="flex h-11 w-fit items-center justify-center gap-2 rounded-lg bg-primary px-space-lg font-headline-sm text-body-md font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Creating…" : "Create task"}
      </button>
    </form>
  );
}
