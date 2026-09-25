"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormField, PasswordField } from "@/components/auth/FormField";
import { FormError, SubmitButton } from "@/components/auth/FormStatus";

import { signInAction, type AuthFormState } from "../actions";

export function LoginForm({ returnPath }: { returnPath: string }) {
  const [state, action] = useActionState<AuthFormState, FormData>(signInAction, {});

  return (
    <form action={action} className="flex flex-col gap-space-lg" noValidate>
      {/* Validated server-side by safeReturnPath; never trusted as submitted. */}
      <input type="hidden" name="next" value={returnPath} />

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

      <div className="flex flex-col gap-space-xs">
        <PasswordField label="Password" name="password" autoComplete="current-password" />
        <Link
          href="/forgot-password"
          className="self-end font-body-sm text-body-sm text-on-surface-variant underline decoration-outline/40 underline-offset-2 transition-colors hover:text-primary-container"
        >
          Forgot your password?
        </Link>
      </div>

      <SubmitButton label="Sign in" pendingLabel="Signing in…" />
    </form>
  );
}
