"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { createAgentAction, type CreateAgentFormState } from "@/app/app/actions";
import type { Principal } from "@/lib/domain";

const INITIAL_STATE: CreateAgentFormState = { ok: false };

const fieldClass =
  "w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-soft focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal";
const labelClass = "text-[13px] font-medium text-ink";
const errorClass = "text-[13px] text-deny";

/**
 * Registers an agent identity directly via `agents_insert_by_developer_and_above`
 * (see createAgentAction) — this records who may later be attributed decisions
 * and capabilities. It does not run, call, or authorize anything by itself.
 */
export function AgentRegistrationForm({ principals }: { principals: Principal[] }) {
  const [state, formAction, pending] = useActionState(createAgentAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.data) router.push(`/app/agents/${state.data.agentId}`);
  }, [state, router]);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      {state.error ? (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className={labelClass}>
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="coding-agent-17"
          aria-describedby={state.fieldErrors?.name ? "name-error" : undefined}
          className={fieldClass}
        />
        {state.fieldErrors?.name ? (
          <p id="name-error" className={errorClass}>
            {state.fieldErrors.name}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="model" className={labelClass}>
            Model
          </label>
          <input
            id="model"
            name="model"
            required
            placeholder="gpt-4o"
            aria-describedby={state.fieldErrors?.model ? "model-error" : undefined}
            className={fieldClass}
          />
          {state.fieldErrors?.model ? (
            <p id="model-error" className={errorClass}>
              {state.fieldErrors.model}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="modelProvider" className={labelClass}>
            Model provider
          </label>
          <input
            id="modelProvider"
            name="modelProvider"
            required
            placeholder="openai"
            aria-describedby={state.fieldErrors?.modelProvider ? "modelProvider-error" : undefined}
            className={fieldClass}
          />
          {state.fieldErrors?.modelProvider ? (
            <p id="modelProvider-error" className={errorClass}>
              {state.fieldErrors.modelProvider}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="framework" className={labelClass}>
          Framework
        </label>
        <input
          id="framework"
          name="framework"
          required
          placeholder="langchain"
          aria-describedby={state.fieldErrors?.framework ? "framework-error" : undefined}
          className={fieldClass}
        />
        {state.fieldErrors?.framework ? (
          <p id="framework-error" className={errorClass}>
            {state.fieldErrors.framework}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ownerPrincipalId" className={labelClass}>
          Owner
        </label>
        <select
          id="ownerPrincipalId"
          name="ownerPrincipalId"
          required
          disabled={principals.length === 0}
          aria-describedby={state.fieldErrors?.ownerPrincipalId ? "owner-error" : undefined}
          className={fieldClass}
        >
          <option value="">Choose the person accountable for this agent…</option>
          {principals.map((principal) => (
            <option key={principal.id} value={principal.id}>
              {principal.displayName}
            </option>
          ))}
        </select>
        {state.fieldErrors?.ownerPrincipalId ? (
          <p id="owner-error" className={errorClass}>
            {state.fieldErrors.ownerPrincipalId}
          </p>
        ) : null}
        {principals.length === 0 ? (
          <p className="text-[13px] text-ink-soft">No principals exist yet in this workspace.</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending || principals.length === 0}
        aria-busy={pending}
        className="mt-1 flex h-10 w-fit items-center justify-center rounded-lg bg-primary px-5 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Registering…" : "Register agent"}
      </button>
    </form>
  );
}
