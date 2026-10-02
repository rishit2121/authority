"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { createPolicyAction, type CreatePolicyFormState } from "@/app/app/actions";

const INITIAL_STATE: CreatePolicyFormState = { ok: false };

const fieldClass =
  "w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-soft focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal";
const labelClass = "text-[13px] font-medium text-ink";
const errorClass = "text-[13px] text-deny";

/**
 * Creates a `draft` policy only. A draft constrains nothing — activating one
 * is a separate, later phase not built in this form — so this write path
 * carries no enforcement risk by itself.
 */
export function PolicyForm() {
  const [state, formAction, pending] = useActionState(createPolicyAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.data) router.push("/app/policies");
  }, [state, router]);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div
        role="note"
        className="rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[13px] text-ink-soft"
      >
        This creates a draft only. A draft has no effect on any task until it is activated — a separate, later
        step.
      </div>

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
          placeholder="Never read repository secrets"
          aria-describedby={state.fieldErrors?.name ? "name-error" : undefined}
          className={fieldClass}
        />
        {state.fieldErrors?.name ? (
          <p id="name-error" className={errorClass}>
            {state.fieldErrors.name}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className={labelClass}>
          Description (optional)
        </label>
        <textarea id="description" name="description" rows={2} className={fieldClass} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="effect" className={labelClass}>
          Effect
        </label>
        <select
          id="effect"
          name="effect"
          required
          defaultValue=""
          aria-describedby={state.fieldErrors?.effect ? "effect-error" : undefined}
          className={fieldClass}
        >
          <option value="" disabled>
            Choose an effect…
          </option>
          <option value="deny">Deny</option>
          <option value="require_approval">Require approval</option>
          <option value="allow">Allow</option>
        </select>
        {state.fieldErrors?.effect ? (
          <p id="effect-error" className={errorClass}>
            {state.fieldErrors.effect}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="conditionKey" className={labelClass}>
            Condition key (optional)
          </label>
          <input id="conditionKey" name="conditionKey" placeholder="resource" className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="conditionMatches" className={labelClass}>
            Matches (glob)
          </label>
          <input
            id="conditionMatches"
            name="conditionMatches"
            placeholder="*secret*"
            className={fieldClass}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="mt-1 flex h-10 w-fit items-center justify-center rounded-lg bg-primary px-5 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Creating…" : "Create policy"}
      </button>
    </form>
  );
}
