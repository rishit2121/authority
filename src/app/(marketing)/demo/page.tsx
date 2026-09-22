import type { Metadata } from "next";
import Link from "next/link";

import { Walkthrough } from "@/components/demo/Walkthrough";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "A step-by-step walkthrough of one runtime authorization pass: trusted task, Task Authority Contract, agent plan, decisions, temporary capability and revocation.",
};

export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-margin py-space-2xl md:px-margin-lg md:py-[88px]">
      <header className="mb-space-2xl max-w-3xl">
        <span className="font-label-caps text-label-caps uppercase tracking-widest text-primary">
          Guided walkthrough
        </span>
        <h1 className="mt-space-sm font-headline-lg text-[2rem] font-semibold leading-[1.18] tracking-tight text-on-surface md:text-[2.75rem]">
          One task, nine decisions, zero standing access.
        </h1>
        <p className="mt-space-md font-body-lg text-body-lg text-on-surface-variant">
          Follow a real coding task from a human instruction through to revocation. Every screen below uses
          mocked data — no repository is contacted and no credential exists.
        </p>
        <p className="mt-space-md font-mono-code text-[11px] text-outline">
          Use the arrow keys to move between steps.
        </p>
      </header>

      <Walkthrough />

      <section className="mt-space-2xl grid grid-cols-1 gap-space-md md:grid-cols-2">
        <Link
          href="/app"
          className="group rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg transition-colors hover:border-outline-variant/60"
        >
          <h2 className="flex items-center gap-2 font-headline-sm text-headline-sm font-semibold text-on-surface">
            Open the control plane
            <Icon
              name="arrow_forward"
              size={16}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </h2>
          <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
            Agents, tasks, capabilities and approvals across a mocked tenant.
          </p>
        </Link>

        <Link
          href="/app/tasks/demo-task"
          className="group rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg transition-colors hover:border-outline-variant/60"
        >
          <h2 className="flex items-center gap-2 font-headline-sm text-headline-sm font-semibold text-on-surface">
            Inspect task #1842
            <Icon
              name="arrow_forward"
              size={16}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </h2>
          <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
            The full contract, plan, decision evidence and execution trace.
          </p>
        </Link>
      </section>
    </div>
  );
}
