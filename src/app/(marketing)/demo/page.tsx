import type { Metadata } from "next";

import { CommandPanel } from "@/components/marketing/proof-run/CommandPanel";
import { ProofRunPlayback } from "@/components/marketing/proof-run/ProofRunPlayback";
import { ProofRunActions, transcriptMatchesRecipe } from "@/components/marketing/proof-run/ProofRunSection";
import { DEMO_COMMANDS, REGRESSION_COMMAND } from "@/lib/proof-run/commands";

export const metadata: Metadata = {
  title: "Example run",
  description:
    "One task, four attempts: an agent may post one update in #engineering and nothing else. See what Authority allows, what it blocks before dispatch, and run the same recipe yourself.",
};

const PROVES = [
  "Real Authority, not a simulation: the runner prepares the task, opens a session, and sends each attempt through authorize and execute.",
  "Slack is a mock transport, so no workspace or account is needed and every request that would reach Slack is counted.",
  "Exactly one dispatch: the post to #engineering reaches the mock Slack once and returns a receipt.",
  "The expected denials: #general is outside the pinned destination, a second post exceeds the limit of one, and email is not in the contract. None of them reaches the provider.",
];

const PREREQUISITES = [
  "Node 22",
  "Docker, for the local Supabase that npx supabase start runs",
  "psql is not needed for the demo",
];

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2
      id={id}
      className="font-headline-lg text-[1.5rem] font-semibold leading-[1.2] tracking-[-0.02em] text-ink md:text-[1.75rem]"
    >
      {children}
    </h2>
  );
}

/** /demo: the same Proof Run as the home page, full width, then how to run it locally. */
export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-6 py-10 md:px-10 md:py-16">
      <header className="max-w-3xl">
        <p className="font-mono-code text-[12px] uppercase tracking-[0.1em] text-ink-soft">Example run</p>
        <h1 className="mt-3 font-display-serif text-[clamp(2.25rem,4.6vw,3.5rem)] font-normal leading-[1.02] tracking-[-0.03em] text-ink">
          Post one update in #engineering. Don&apos;t email anyone.
        </h1>
        <p className="mt-4 text-[16px] leading-[1.6] text-ink-soft">
          One task, four things the agent tries. The task allows one Slack post to one channel; Authority
          decides each attempt before anything reaches Slack. This page plays back a recorded run and connects
          to nothing.
        </p>
      </header>

      <section id="proof-run" aria-label="Example run playback" className="mt-8 scroll-mt-[80px]">
        <ProofRunPlayback recipeHashMatches={transcriptMatchesRecipe()} layout="full" />
        <ProofRunActions />
      </section>

      <section aria-labelledby="run-it-heading" className="mt-14 border-t border-line pt-10">
        <SectionHeading id="run-it-heading">Run it yourself</SectionHeading>
        <p className="mt-3 max-w-[40rem] text-[15px] leading-[1.6] text-ink-soft">
          Clone the repository and run the same recipe against a local Authority and a mock Slack.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <CommandPanel
              title="Run the example"
              commands={DEMO_COMMANDS}
              copyLabel="Copy demo commands"
              testId="demo-commands"
            />
            <div>
              <p className="mb-2 text-[14px] font-medium text-ink">Keep it as a regression test</p>
              <CommandPanel
                title="Same recipe, as a test"
                commands={[REGRESSION_COMMAND]}
                copyLabel="Copy regression test command"
                testId="demo-regression"
              />
            </div>
          </div>

          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink">Prerequisites</h3>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-[1.55] text-ink">
              {PREREQUISITES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <h3 className="mt-10 text-[17px] font-semibold text-ink">What the runner proves</h3>
        <ul className="mt-3 flex max-w-[48rem] flex-col gap-2 text-[15px] leading-[1.6] text-ink">
          {PROVES.map((item) => (
            <li key={item} className="flex gap-2">
              <span
                aria-hidden="true"
                className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-[999px] bg-signal"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
