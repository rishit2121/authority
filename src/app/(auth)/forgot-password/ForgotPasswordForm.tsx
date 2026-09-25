"use client";

import { useActionState } from "react";

import { FormField } from "@/components/auth/FormField";
import { FormError, FormSuccess, SubmitButton } from "@/components/auth/FormStatus";

import { requestPasswordResetAction, type AuthFormState } from "../actions";

export function ForgotPasswordForm() {
  const [state, action] = useActionState<AuthFormState, FormData>(requestPasswordResetAction, {});

  if (state.success) {
    return <FormSuccess message={state.success} />;
  }

  return (
    <form action={action} className="flex flex-col gap-space-lg" noValidate>
      <FormError message={state.error} />

      <FormField
        label="Work email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        defaultValue={state.email}
        placeholder="you@company.com"
      />

      <SubmitButton label="Send reset link" pendingLabel="Sending…" />
    </form>
  );
}
