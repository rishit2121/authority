import { InkButton } from "@/components/marketing/InkButton";
import { InkOutlineButton } from "@/components/marketing/InkOutlineButton";
import { HeroAuthorityGraph } from "@/components/marketing/graph/HeroAuthorityGraph";

export function Hero() {
  // Background and the field-line system both live on the shared wrapper in page.tsx, not here —
  // this section must stay transparent so the lines show through underneath it. No bottom border
  // either: whitespace and the continuing lines are the transition into the next section.
  return (
    <section id="top" className="relative">
      {/* Not MarketingContainer: the hero's 1320px content width is wider than that shared
          1120px container, and stacking two max-w-* utilities on one element is unreliable
          (whichever Tailwind happens to emit last in the stylesheet wins, not the one that
          looks like an "override" in the className string) — it caused a real ~24px
          horizontal-overflow bug at 1024px during the hero/header correction. */}
      <div className="mx-auto w-full max-w-[1320px] px-6 md:px-10">
        {/* `fr` tracks, not `%`: percentage tracks are sized against the full container width
            and ignore `gap`, so `43%_57%` plus a column gap overflowed the container by exactly
            the gap width. `fr` tracks correctly share the space left over after the gap.

            `items-start`, not `items-center`: centering the grid vertically within a tall
            min-height box was pushing the headline ~150px lower than intended, since the whole
            row centered around the taller graph column rather than the text column aligning to
            the top on its own.

            Note that this min-height is rarely the binding constraint any more: now that the
            graph has its own fixed 580px centering wrapper (see HeroAuthorityGraph), the row's
            natural content height already exceeds any reasonable floor here on every normal
            viewport. It only matters as a fallback on unusually short viewports — the real
            control over the hero's total height (and therefore how much blank space sits below
            it) is this `py` clamp plus the graph wrapper's own min-height. */}
        <div className="grid min-h-[min(100svh-64px,620px)] grid-cols-1 items-start gap-10 py-[clamp(3rem,6vh,5rem)] lg:grid-cols-[43fr_57fr] lg:gap-x-16">
          {/* Left column — text, left-aligned on desktop. DOM order (text, then graph) already
              matches both layouts: stacked text-then-graph on mobile, left/right columns on
              desktop — no order-* reordering needed. Its own small padding-top is independent of
              the graph column's height, so the two can't drag each other out of position. */}
          <div className="flex flex-col items-start lg:pt-[clamp(2rem,5vh,4rem)]">
            <span className="font-headline-sm text-[13px] uppercase tracking-[0.12em] text-ink-soft">
              Control plane for AI agents
            </span>

            <h1 className="mt-5 font-display-serif text-[clamp(4rem,6.3vw,6.8rem)] font-normal leading-[0.91] tracking-[-0.035em] text-ink">
              Let agents act.
              <br />
              Keep authority
              <br />
              bounded.
            </h1>

            <p className="mt-8 max-w-[34rem] text-[clamp(1.05rem,1.4vw,1.25rem)] leading-[1.55] text-ink-soft">
              Turn each task into the minimum authority an agent needs—then verify every tool call at runtime.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <InkButton href="/request-access">Request access</InkButton>
              <InkOutlineButton href="/demo">See a tool call</InkOutlineButton>
            </div>

            <p className="mt-6 font-mono-code text-[12px] tracking-wide text-ink-soft">
              Temporary permissions · Exact resources · Complete decision trace
            </p>
          </div>

          {/* Right column — hero authority visualization. */}
          <div className="w-full">
            <HeroAuthorityGraph />
          </div>
        </div>
      </div>
    </section>
  );
}
