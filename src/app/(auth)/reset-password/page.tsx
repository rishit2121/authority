import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { FormError } from "@/components/auth/FormStatus";
import { createClient } from "@/lib/supabase/server";

import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Complete your Authority password reset.",
};

/**
 * Reached from the recovery email, which lands on /auth/callback first. That
 * handler exchanges the code for a session and forwards here, so by this point
 * a recovery session should exist.
 *
 * The session is checked here rather than only in the action so an expired link
 * says so immediately, instead of after the user has typed a new password
 * twice.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const hasRecoverySession = Boolean(data.user);

  return (
    <AuthShell
      title="Choose a new password"
      description={
        hasRecoverySession
          ? "Pick something you haven't used for this account before."
          : "This reset link is no longer valid."
      }
      footer={
        <p>
          <Link
            href={hasRecoverySession ? "/login" : "/forgot-password"}
            className="font-medium text-primary-container underline decoration-primary-container/40 underline-offset-2"
          >
            {hasRecoverySession ? "Back to sign in" : "Request a new link"}
          </Link>
        </p>
      }
      aside="Choose something unique to Authority. Password managers are encouraged."
    >
      {hasRecoverySession ? (
        <ResetPasswordForm />
      ) : (
        <FormError message="That reset link has expired or was already used. Request a new one to continue." />
      )}
    </AuthShell>
  );
}
