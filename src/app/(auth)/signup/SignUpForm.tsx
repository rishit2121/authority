"use client";

import { useActionState } from "react";

import { FormField, PasswordField } from "@/components/auth/FormField";
import { FormError, FormSuccess, SubmitButton } from "@/components/auth/FormStatus";

import { signUpAction, type AuthFormState } from "../actions";

export function SignUpForm() {
  const [state, action] = useActionState<AuthFormState, FormData>(signUpAction, {});

  // Once the confirmation email is out, the form is replaced rather than left
  // filled in, so there is no ambiguity about whether to submit again.
  if (state.success) {
    return (
      <div className="flex flex-col gap-space-lg">
        <FormSuccess message={state.success} />
        <p className="font-body-md text-body-sm text-on-surface-variant">
          The link expires after a short while. If it does, you can sign up again with the same address.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-space-lg" noValidate>
      <FormError message={state.error} />

      <FormField
        label="Full name"
        name="displayName"
        autoComplete="name"
        placeholder="Maya Okafor"
        hint="Shown to other members of your workspace."
      />

      <FormField
        label="Work email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        defaultValue={state.email}
        placeholder="you@company.com"
      />

      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        hint="At least 12 characters."
      />

      <PasswordField label="Confirm password" name="confirmPassword" autoComplete="new-password" />

      <SubmitButton label="Create account" pendingLabel="Creating account…" />
    </form>
  );
}
