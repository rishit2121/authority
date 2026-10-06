"use client";

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/ui/Icon";

export interface OnboardingProgress {
  agent: boolean;
  task: boolean;
  activeContract: boolean;
  runtimeCall: boolean;
  githubConnected: boolean;
  validationRun: boolean;
  developerApiConfigured: boolean;
}

interface Step {
  key: keyof OnboardingProgress;
  title: string;
  hint: string;
  href: string;
  cta: string;
}

/** The four-step core workflow a new developer needs to complete once. */
const CORE_STEPS: Step[] = [
  {
    key: "agent",
    title: "Register an agent",
    hint: "Give your agent an identity and a runtime key, shown once.",
    href: "/app/agents/new",
    cta: "Register an agent",
  },
  {
    key: "task",
    title: "Create a task",
    hint: "State the intent. Authority compiles the minimum authority it needs.",
    href: "/app/tasks/new",
    cta: "Create a task",
  },
  {
    key: "activeContract",
    title: "Review its minimum scope",
    hint: "Review the compiled contract and activate it — nothing can run without one.",
    href: "/app/tasks",
    cta: "Review the task contract",
  },
  {
    key: "runtimeCall",
    title: "Send an authorized tool call",
    hint: "Call POST /api/v1/authorize from your agent with its runtime key.",
    href: "/app/runtime",
    cta: "View tool calls",
  },
];

/** Shown later, once the core workflow is understood — never inside it. */
const OPTIONAL_STEPS: Step[] = [
  {
    key: "developerApiConfigured",
    title: "Connect your own agent from code",
    hint: "Create an application and backend credential, then prepare and run a task with the TypeScript SDK (examples/connector-quickstart) instead of the dashboard.",
    href: "/app/settings/applications",
    cta: "Set up the developer API",
  },
  {
    key: "githubConnected",
    title: "Connect GitHub",
    hint: "Lets Authority execute approved GitHub calls on an allow-listed repository.",
    href: "/app/integrations/github",
    cta: "Connect GitHub",
  },
  {
    key: "validationRun",
    title: "Attack your own controls",
    hint: "Run the starter scenario pack in the Validation Lab — synthetic, safe, about a minute.",
    href: "/app/validation",
    cta: "Open Validation Lab",
  },
];

function StepRow({ step, status }: { step: Step; status: "complete" | "current" | "not-started" }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon
        name={status === "complete" ? "check_circle" : "arrow_forward"}
        size={18}
        className={`mt-0.5 shrink-0 ${status === "complete" ? "text-signal" : status === "current" ? "text-ink" : "text-line-strong"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div
          className={`text-[14px] ${status === "complete" ? "text-ink-soft line-through" : status === "current" ? "font-medium text-ink" : "text-ink-soft"}`}
        >
          {step.title}
        </div>
        {status === "current" ? <div className="mt-0.5 text-[13px] text-ink-soft">{step.hint}</div> : null}
      </div>
      {status === "current" ? (
        <Link
          href={step.href}
          className="shrink-0 rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-fixed"
        >
          {step.cta}
        </Link>
      ) : null}
    </li>
  );
}

function statusFor(progress: OnboardingProgress, step: Step, firstIncompleteKey: string | null) {
  if (progress[step.key]) return "complete" as const;
  if (step.key === firstIncompleteKey) return "current" as const;
  return "not-started" as const;
}

/**
 * The primary first-run onboarding section for an empty workspace: a large
 * heading, the four-step core workflow, and GitHub/Validation Lab offered
 * afterward as optional — never inside the core four.
 */
export function OnboardingPrimary({ progress }: { progress: OnboardingProgress }) {
  const firstIncomplete = CORE_STEPS.find((s) => !progress[s.key])?.key ?? null;
  const coreDone = CORE_STEPS.every((s) => progress[s.key]);

  return (
    <section
      aria-labelledby="onboarding-heading"
      className="rounded-[10px] border border-line bg-paper-raised p-6"
    >
      <h1 id="onboarding-heading" className="font-display-serif text-[32px] font-normal text-ink">
        Protect your first agent
      </h1>
      <p className="mt-2 max-w-md text-[14px] text-ink-soft">
        Connect an agent, describe a task, and inspect the exact authority it receives.
      </p>

      <ol className="mt-5 flex flex-col divide-y divide-line">
        {CORE_STEPS.map((step) => (
          <StepRow key={step.key} step={step} status={statusFor(progress, step, firstIncomplete)} />
        ))}
      </ol>

      {coreDone ? (
        <div className="mt-5 border-t border-line pt-4">
          <span className="text-[12px] font-medium uppercase tracking-wide text-ink-soft">
            Optional next steps
          </span>
          <ol className="mt-2 flex flex-col divide-y divide-line">
            {OPTIONAL_STEPS.map((step) => (
              <StepRow key={step.key} step={step} status={progress[step.key] ? "complete" : "not-started"} />
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The compact, collapsible version for an already-configured workspace that
 * hasn't finished every step yet — never the large first-run heading.
 */
export function OnboardingCompact({ progress }: { progress: OnboardingProgress }) {
  const [open, setOpen] = useState(false);
  const allSteps = [...CORE_STEPS, ...OPTIONAL_STEPS];
  const done = allSteps.filter((s) => progress[s.key]).length;
  if (done === allSteps.length) return null;

  const firstIncomplete = CORE_STEPS.find((s) => !progress[s.key])?.key ?? null;

  return (
    <section className="rounded-[10px] border border-line bg-paper-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-[14px] font-medium text-ink">Continue setup</span>
        <span className="flex items-center gap-2 text-[12px] text-ink-soft">
          {done} of {allSteps.length} done
          <Icon name="expand_more" size={16} className={open ? "rotate-180" : ""} />
        </span>
      </button>
      {open ? (
        <div className="border-t border-line px-4 pb-3">
          <ol className="flex flex-col divide-y divide-line">
            {CORE_STEPS.map((step) => (
              <StepRow key={step.key} step={step} status={statusFor(progress, step, firstIncomplete)} />
            ))}
            {OPTIONAL_STEPS.map((step) => (
              <StepRow key={step.key} step={step} status={progress[step.key] ? "complete" : "not-started"} />
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
