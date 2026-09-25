import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your Authority account.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter the address you signed up with and we'll send a link to choose a new password."
      footer={
        <p>
          <Link
            href="/login"
            className="font-medium text-primary-container underline decoration-primary-container/40 underline-offset-2"
          >
            Back to sign in
          </Link>
        </p>
      }
      aside="For your security, we don't disclose whether an address has an account."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
