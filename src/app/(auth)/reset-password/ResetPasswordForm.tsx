"use client";

import { useActionState } from "react";

import { PasswordField } from "@/components/auth/FormField";
import { FormError, SubmitButton } from "@/components/auth/FormStatus";

import { updatePasswordAction, type AuthFormState } from "../actions";

export function ResetPasswordForm() {
  const [state, action] = useActionState<AuthFormState, FormData>(updatePasswordAction, {});

  return (
    <form action={action} className="flex flex-col gap-space-lg" noValidate>
      <FormError message={state.error} />

      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        hint="At least 12 characters."
      />

      <PasswordField label="Confirm new password" name="confirmPassword" autoComplete="new-password" />

      <SubmitButton label="Set new password" pendingLabel="Saving…" />
    </form>
  );
}
