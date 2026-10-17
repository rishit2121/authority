"use client";

import { useActionState, useId } from "react";

import { FormField } from "@/components/auth/FormField";
import { FormError, FormSuccess, SubmitButton } from "@/components/auth/FormStatus";
import { PILOT_LIMITS } from "@/lib/pilot/limits";

import { requestPilotAccessAction, type PilotRequestFormState } from "./actions";

const textareaClasses =
  "w-full rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-2.5 font-body-md text-body-md text-on-surface placeholder:text-outline/70 transition-colors focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container";

function TextAreaField({
  label,
  name,
  maxLength,
  required = true,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  maxLength: number;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-space-xs">
      <label htmlFor={id} className="font-body-md text-body-sm font-medium text-on-surface">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={3}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={textareaClasses}
      />
    </div>
  );
}

export function RequestAccessForm() {
  const [state, action] = useActionState<PilotRequestFormState, FormData>(requestPilotAccessAction, {});

  if (state.success) return <FormSuccess message={state.success} />;

  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-space-lg" noValidate>
      <FormError message={state.error} />
      <FormField label="Name" name="name" autoComplete="name" defaultValue={v.name} />
      <FormField
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        defaultValue={v.email}
        placeholder="you@company.com"
        hint="If you're approved, sign up with this address."
      />
      <FormField
        label="Company or project (optional)"
        name="company"
        autoComplete="organization"
        required={false}
        defaultValue={v.company}
      />
      <TextAreaField
        label="What are you building?"
        name="building"
        maxLength={PILOT_LIMITS.building}
        defaultValue={v.building}
      />
      <TextAreaField
        label="How would you use Authority?"
        name="usage"
        maxLength={PILOT_LIMITS.usage}
        defaultValue={v.usage}
      />
      <FormField
        label="Services or tools (optional)"
        name="services"
        required={false}
        defaultValue={v.services}
        placeholder="e.g. Gmail, Stripe, GitHub"
      />
      {/* Honeypot, hidden from people and assistive tech. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />
      <SubmitButton label="Request access" pendingLabel="Sending…" />
    </form>
  );
}
