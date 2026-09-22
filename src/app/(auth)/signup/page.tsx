import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";

import { SignUpForm } from "./SignUpForm";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create an Authority account and a first workspace.",
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="You'll get a personal workspace to start with. Invite your team once you're in."
      footer={
        <p>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary-container underline decoration-primary-container/40 underline-offset-2"
          >
            Sign in
          </Link>
        </p>
      }
      aside="Agents receive authority for the task, not access to the account."
    >
      <SignUpForm />
    </AuthShell>
  );
}
