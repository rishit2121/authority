import type { Metadata } from "next";
import Link from "next/link";

import { DOCS_NAV } from "@/components/docs/docs-nav-data";

export const metadata: Metadata = {
  title: "Authority Docs",
  description:
    "Connect your own agent to Authority's runtime API — authentication, authorization, execution, and connector guides.",
};

export default function DocsIndexPage() {
  return (
    <article className="max-w-[720px]">
      <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-ink md:text-[2rem]">
        Authority developer docs
      </h1>
      <p className="mt-2 text-[15px] leading-[1.6] text-ink-soft">
        Connect your own agent to Authority&apos;s real, already-implemented runtime API. Use the typed{" "}
        <code className="font-mono-code text-[13px]">@authority/sdk</code> client (
        <code className="font-mono-code text-[13px]">examples/connector-quickstart</code>,{" "}
        <code className="font-mono-code text-[13px]">examples/model-driven-agent</code>) or call the raw HTTP
        API directly — no SDK is required either way. Two credentials, one authorize call, one execute call.
        Start with the Quickstart.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DOCS_NAV.flatMap((item) => (item.children ? item.children : [item])).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-[10px] border border-line bg-paper-raised p-4 transition-colors hover:bg-black/[0.02]"
          >
            <span className="text-[14px] font-medium text-ink">{item.label}</span>
          </Link>
        ))}
      </div>
    </article>
  );
}
