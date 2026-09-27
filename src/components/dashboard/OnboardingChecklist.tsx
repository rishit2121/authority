import Link from "next/link";

import { Icon } from "@/components/ui/Icon";

export interface OnboardingProgress {
  agent: boolean;
  task: boolean;
  activeContract: boolean;
  runtimeCall: boolean;
  githubConnected: boolean;
  validationRun: boolean;
}

const STEPS: Array<{
  key: keyof OnboardingProgress;
  title: string;
  hint: string;
  href: string;
  cta: string;
}> = [
  {
    key: "agent",
    title: "Register an agent",
    hint: "Give your agent an identity and a runtime key (shown once).",
    href: "/app/agents",
    cta: "Agents",
  },
  {
    key: "task",
    title: "Create a task",
    hint: "State the intent and the candidate plan. Authority compiles the minimum authority for it.",
    href: "/app/tasks/new",
    cta: "New task",
  },
  {
    key: "activeContract",
    title: "Activate the contract",
    hint: "Review the compiled contract and activate it. Nothing can run without one.",
    href: "/app/tasks",
    cta: "Tasks",
  },
  {
    key: "runtimeCall",
    title: "Send your first authorization call",
    hint: "Call POST /api/v1/authorize from your agent with its runtime key. See docs/QUICKSTART.md.",
    href: "/app/runtime",
    cta: "Runtime",
  },
  {
    key: "githubConnected",
    title: "Connect GitHub (optional)",
    hint: "Lets Authority execute approved GitHub calls itself, on an allow-listed repository.",
    href: "/app/integrations/github",
    cta: "GitHub",
  },
  {
    key: "validationRun",
    title: "Attack your own controls",
    hint: "Run the starter scenario pack in the Validation Lab: synthetic, safe, about a minute.",
    href: "/app/validation",
    cta: "Validation Lab",
  },
];

export function OnboardingChecklist({ progress }: { progress: OnboardingProgress }) {
  const done = STEPS.filter((s) => progress[s.key]).length;
  if (done === STEPS.length) return null;
  return (
    <section
      aria-labelledby="onboarding-heading"
      className="rounded-xl border border-primary/30 bg-primary/5 p-space-lg"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="onboarding-heading"
          className="font-headline-sm text-headline-sm font-semibold text-on-surface"
        >
          Get started
        </h2>
        <span className="font-mono-code text-[12px] text-outline">
          {done} of {STEPS.length} done
        </span>
      </div>
      <ol className="mt-space-sm flex flex-col gap-2">
        {STEPS.map((s) => {
          const ok = progress[s.key];
          return (
            <li key={s.key} className="flex flex-wrap items-start gap-3">
              <Icon
                name={ok ? "check_circle" : "arrow_forward"}
                size={18}
                className={ok ? "mt-0.5 text-allow" : "mt-0.5 text-outline"}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div
                  className={`font-body-md text-body-md ${ok ? "text-on-surface-variant line-through" : "text-on-surface"}`}
                >
                  {s.title}
                </div>
                {!ok ? (
                  <div className="font-body-sm text-body-sm text-on-surface-variant">{s.hint}</div>
                ) : null}
              </div>
              {!ok ? (
                <Link href={s.href} className="font-body-sm text-body-sm text-primary underline">
                  {s.cta}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
