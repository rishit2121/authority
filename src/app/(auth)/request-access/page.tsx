import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";

import { RequestAccessForm } from "./RequestAccessForm";

export const metadata: Metadata = {
  title: "Request access",
  description: "Authority is an invite-only developer pilot. Tell us what you're building.",
};

export default function RequestAccessPage() {
  return (
    <AuthShell
      title="Request access"
      description="Authority is an invite-only developer pilot. Tell us what you're building — no account needed. Every request is reviewed by hand."
      footer={
        <p>
          Already approved?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary-container underline decoration-primary-container/40 underline-offset-2"
          >
            Create your account
          </Link>{" "}
          or{" "}
          <Link
            href="/login"
            className="font-medium text-primary-container underline decoration-primary-container/40 underline-offset-2"
          >
            sign in
          </Link>
          .
        </p>
      }
    >
      <RequestAccessForm />
    </AuthShell>
  );
}
