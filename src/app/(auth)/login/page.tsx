import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { DEFAULT_AUTHENTICATED_PATH, RETURN_PATH_PARAM, safeReturnPath } from "@/lib/auth/redirect";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the Authority control plane.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = params[RETURN_PATH_PARAM];

  // Normalized before it reaches the form, so the hidden field can never carry
  // an external destination even momentarily.
  const returnPath = safeReturnPath(
    Array.isArray(requested) ? requested[0] : requested,
    DEFAULT_AUTHENTICATED_PATH,
  );

  return (
    <AuthShell
      title="Sign in"
      description="Access the control plane to review task authority, decisions and active capabilities."
      footer={
        <p>
          Need an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary-container underline decoration-primary-container/40 underline-offset-2"
          >
            Create one
          </Link>
        </p>
      }
      aside="Authority issues short-lived, constrained capabilities for a single task. It never holds standing credentials for your accounts."
    >
      <LoginForm returnPath={returnPath} />
    </AuthShell>
  );
}
