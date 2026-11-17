import Link from "next/link";

import { InkButton } from "@/components/marketing/InkButton";
import { REGRESSION_COMMAND, REPO_URL } from "@/lib/proof-run/commands";
import { recipeHash } from "@/lib/proof-run/hash";
import { capturedRun, engineeringUpdateRecipe } from "@/lib/proof-run/recipe";

import { CopyTextButton } from "./CopyTextButton";
import { ProofRunPlayback } from "./ProofRunPlayback";

export const RECIPE_FILE_URL = `${REPO_URL}/blob/main/examples/proof-run/engineering-update.json`;

/** Server-side: whether the checked-in transcript was captured from the recipe as it is now. */
export function transcriptMatchesRecipe(): boolean {
  return capturedRun.recipeHash === recipeHash(engineeringUpdateRecipe);
}

/** The two follow-up actions after the playback: integrate it, or keep it as a regression test. */
export function ProofRunActions() {
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <InkButton href="/docs/quickstart">Use this in my app</InkButton>
        <CopyTextButton
          text={REGRESSION_COMMAND}
          label="Copy regression test"
          announce="Regression test command copied"
          data-testid="copy-regression"
          className="inline-flex min-h-[46px] items-center justify-center rounded-[9px] border border-line-strong bg-transparent px-6 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        />
      </div>
      <p className="max-w-[44rem] text-[14px] leading-[1.55] text-ink-soft">
        Runs the same recipe against a local Authority and a mock Slack. Fails if an expected block becomes an
        allow or a provider dispatch appears.{" "}
        <Link
          href={RECIPE_FILE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
        >
          View the recipe on GitHub
        </Link>
      </p>
    </div>
  );
}

/** Home page section: heading, the playback, then the follow-up actions. */
export function ProofRunSection() {
  return (
    <section id="proof-run" aria-labelledby="proof-run-heading" className="scroll-mt-[80px] py-10 md:py-14">
      <div className="mx-auto w-full max-w-[1120px] px-6 md:px-10">
        <h2
          id="proof-run-heading"
          className="font-display-serif text-[clamp(2rem,3.4vw,2.85rem)] font-normal leading-[1.05] tracking-[-0.02em] text-ink"
        >
          Post one update in #engineering. Don&apos;t email anyone.
        </h2>
        <p className="mt-3 max-w-[40rem] text-[16px] leading-[1.6] text-ink-soft">
          The task allows one Slack post to one channel. Pick what the agent tries and see what Authority does
          before anything reaches Slack.
        </p>
        <div className="mt-6">
          <ProofRunPlayback recipeHashMatches={transcriptMatchesRecipe()} />
        </div>
        <ProofRunActions />
      </div>
    </section>
  );
}
