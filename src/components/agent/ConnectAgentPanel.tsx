import Link from "next/link";

export function ConnectAgentPanel({ baseUrl }: { baseUrl: string }) {
  return (
    <section
      aria-labelledby="connect-agent-heading"
      className="rounded-[10px] border border-line bg-paper-raised p-4"
    >
      <h2 id="connect-agent-heading" className="text-[15px] font-semibold text-ink">
        Connect your agent
      </h2>
      <p className="mt-1 text-[13px] text-ink-soft">
        An agent authenticates to Authority with the runtime key above — never a browser session, never a
        Supabase credential. Set it as an environment variable alongside the base URL below, then follow the{" "}
        <Link href="/docs/quickstart" className="underline underline-offset-2">
          Quickstart
        </Link>{" "}
        to authorize and execute its first call.
      </p>
      <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
        <div className="flex items-center gap-2">
          <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Base URL</dt>
          <dd className="font-mono-code text-ink">{baseUrl}</dd>
        </div>
      </dl>
      <div className="mt-3 flex gap-3 text-[13px]">
        <Link href="/docs/authentication" className="underline underline-offset-2">
          Authentication
        </Link>
        <Link href="/docs/quickstart" className="underline underline-offset-2">
          Quickstart
        </Link>
      </div>
    </section>
  );
}
