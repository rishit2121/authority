import type { Metadata } from "next";

export const metadata: Metadata = { title: "Connection could not be completed" };

const MESSAGES: Record<string, string> = {
  session_not_found_or_expired:
    "This connection link has expired or was already used. Ask the application you were connecting to start a new one.",
  provider_not_supported_for_embedded_connect: "This provider does not support an embedded connection yet.",
  not_configured: "This provider is not configured on this deployment yet.",
  not_started_here:
    "This sign-in did not start from this browser. Ask the application to start a new connection.",
  invalid_state:
    "This sign-in session expired or was tampered with. Ask the application to start a new connection.",
  oauth_denied: "The sign-in was cancelled or denied.",
  oauth_exchange_failed: "The provider did not accept that sign-in.",
  session_already_resolved: "This connection link was already used.",
};

export default async function ConnectErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : null;
  const message = (reason && MESSAGES[reason]) ?? "Something went wrong completing this connection.";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
      <h1 className="text-[20px] font-semibold text-ink">Connection could not be completed</h1>
      <p className="max-w-md text-[14px] text-ink-soft">{message}</p>
      <p className="text-[12px] text-ink-soft">
        You can close this window and try again from the application.
      </p>
    </div>
  );
}
