import Link from "next/link";

import { AuthorityGraph } from "@/components/graph/AuthorityGraph";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";

export function Hero() {
  return (
    <section
      id="top"
      className="relative mx-auto flex w-full max-w-[1280px] items-center px-margin py-space-2xl md:min-h-[780px] md:px-margin-lg"
    >
      <div className="grid w-full grid-cols-1 items-center gap-space-2xl lg:grid-cols-12">
        <div className="z-10 flex flex-col items-start lg:col-span-5">
          <div className="mb-space-lg inline-flex items-center gap-space-sm rounded-full border border-outline-variant/30 bg-surface-container px-space-md py-1 shadow-sm">
            <StatusDot className="bg-allow" />
            <span className="font-mono-token text-mono-token uppercase tracking-wider text-allow">
              Runtime Authorization for AI Agents
            </span>
          </div>

          <h1 className="mb-space-lg font-display-lg text-[2.75rem] font-semibold leading-[1.08] tracking-[-0.035em] text-on-surface md:text-[3.75rem]">
            Give every AI agent <span className="text-primary">exactly</span> the authority its task requires.
          </h1>

          <p className="mb-space-xl max-w-xl font-body-lg text-body-lg text-on-surface-variant">
            Your agent proposes actions. The control plane independently verifies each request against user
            intent and company policy, grants the smallest temporary capability, and blocks everything else.
          </p>

          <div className="flex w-full flex-wrap items-center gap-space-md sm:w-auto">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-lg bg-on-surface px-space-xl py-3 font-headline-sm text-body-md font-medium text-surface-container-lowest shadow-[0_1px_12px_rgba(255,255,255,0.2)] transition-all hover:bg-white hover:shadow-[0_2px_20px_rgba(255,255,255,0.35)]"
            >
              Start free — no waitlist
            </Link>
            <a
              href="/demo"
              className="group inline-flex items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container px-space-lg py-3 font-body-md text-body-md text-on-surface transition-all hover:border-outline-variant/80 hover:bg-surface-container-high"
            >
              See how it works
              <Icon
                name="arrow_forward"
                size={16}
                className="ml-1 transition-transform group-hover:translate-x-0.5"
              />
            </a>
          </div>

          <div className="mt-space-xl flex items-center gap-2 border-t border-outline-variant/20 pt-space-lg font-mono-code text-[0.75rem] text-outline">
            <Icon name="verified_user" size={14} className="text-primary" />
            <span>Any model · Any framework · MCP &amp; API tools · No standing credentials</span>
          </div>
        </div>

        <div className="relative w-full lg:col-span-7">
          <AuthorityGraph />
        </div>
      </div>
    </section>
  );
}
