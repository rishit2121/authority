import { InkButton } from "@/components/marketing/InkButton";
import { InkOutlineButton } from "@/components/marketing/InkOutlineButton";
import { CommandPanel } from "@/components/marketing/proof-run/CommandPanel";
import { ScopeCard } from "@/components/marketing/proof-run/ScopeCard";
import { DEMO_COMMANDS } from "@/lib/proof-run/commands";
import { scopeCardFor } from "@/lib/proof-run/presentation";
import { engineeringUpdateRecipe } from "@/lib/proof-run/recipe";

/**
 * Compact two-column hero: the promise and two actions on the left; the real commands and the example task's scope
 * on the right. DOM order is also the mobile order (headline, line, actions, commands, scope), so no reordering.
 */
export function Hero() {
  const scope = scopeCardFor(engineeringUpdateRecipe);
  return (
    <section id="top" aria-labelledby="hero-heading">
      <div className="mx-auto grid w-full max-w-[1120px] grid-cols-1 items-center gap-8 px-6 pb-4 pt-10 md:px-10 md:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-12 lg:pt-16">
        <div className="flex min-w-0 flex-col items-start">
          <p className="font-mono-code text-[12px] uppercase tracking-[0.1em] text-ink-soft">
            Runtime limits for AI agents
          </p>
          <h1
            id="hero-heading"
            className="mt-4 font-display-serif text-[clamp(2.75rem,5vw,4.25rem)] font-normal leading-[0.98] tracking-[-0.03em] text-ink"
          >
            {/* Two spans, not a <br>: the heading's text stays exactly one sentence pair for readers and tests. */}
            <span className="sm:block">Give your agent tools. </span>
            <span className="sm:block">Set the limits.</span>
          </h1>
          <p className="mt-5 max-w-[34rem] text-[clamp(1.02rem,1.3vw,1.15rem)] leading-[1.55] text-ink-soft">
            Decide what an agent can do for each task. Authority checks the tool, the destination and the
            usage limit before the call runs.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <InkButton href="#proof-run">Try a protected call</InkButton>
            <InkOutlineButton href="/app/setup">Set up my agent</InkOutlineButton>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <CommandPanel
            title="Run the example locally"
            commands={DEMO_COMMANDS}
            copyLabel="Copy demo commands"
            testId="hero-commands"
          />
          <ScopeCard scope={scope} testId="hero-scope" />
        </div>
      </div>
    </section>
  );
}
