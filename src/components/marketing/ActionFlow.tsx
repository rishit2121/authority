import { Icon } from "@/components/ui/Icon";

import { MarketingContainer } from "./MarketingContainer";

/** A short line segment drawn in SVG so it can stretch with its flex cell; the stroke width never scales. */
function Line({ tone, className = "" }: { tone: "neutral" | "allowed" | "blocked"; className?: string }) {
  const stroke = tone === "allowed" ? "#087F69" : tone === "blocked" ? "#B5524F" : "#5F655E";
  return (
    <svg aria-hidden="true" viewBox="0 0 100 4" preserveAspectRatio="none" className={`h-1 ${className}`}>
      <line
        x1="0"
        y1="2"
        x2="100"
        y2="2"
        stroke={stroke}
        strokeWidth="2"
        strokeDasharray={tone === "neutral" ? "4 6" : tone === "allowed" ? "10 10" : undefined}
        vectorEffect="non-scaling-stroke"
        className={tone === "blocked" ? undefined : "action-flow-march"}
      />
    </svg>
  );
}

function Node({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="shrink-0 rounded-[10px] border border-ink bg-paper px-4 py-3 text-center md:w-[10.5rem]">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">{detail}</p>
    </div>
  );
}

/**
 * "Your agent → Authority → Slack": one call reaches Slack, the other stops at Authority. The words carry the meaning
 * (allowed / blocked before dispatch); color, icon and the marching dashes only reinforce it, and the dashes stand
 * still under reduced motion (globals.css).
 */
export function ActionFlow() {
  return (
    <section aria-labelledby="action-flow-heading" className="pb-6 pt-8 md:pb-8 md:pt-12">
      <MarketingContainer>
        <h2 id="action-flow-heading" className="sr-only">
          How a call flows through Authority
        </h2>
        <figure className="rounded-[14px] border border-line bg-paper-raised p-4 sm:p-6">
          <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center md:gap-0">
            <Node title="Your agent" detail="proposes two posts" />

            <div className="flex items-center gap-2 px-1 md:flex-1 md:px-3">
              <Line tone="neutral" className="w-8 md:w-full" />
              <span className="shrink-0 text-[12.5px] text-ink-soft">tool calls</span>
              <Line tone="neutral" className="hidden w-full md:block" />
            </div>

            <Node title="Authority" detail="checks each call" />

            <div className="flex flex-col gap-3 px-1 md:flex-[1.6] md:px-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center">
                  <Line tone="allowed" className="w-12 md:w-full" />
                  <Icon name="chevron_right" size={18} className="-ml-1.5 text-signal" />
                </div>
                <p className="flex items-center gap-1.5 text-[13.5px] text-ink">
                  <Icon name="check_circle" size={15} className="text-signal" />
                  <span>
                    Post to #engineering · <strong className="font-semibold text-signal">allowed</strong>
                  </span>
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center">
                  <Line tone="blocked" className="w-6 md:w-10" />
                  <Icon name="block" size={16} className="action-flow-stop text-denied" />
                </div>
                <p className="flex items-start gap-1.5 text-[13.5px] text-ink">
                  <Icon name="block" size={15} className="mt-0.5 text-denied" />
                  <span>
                    Post to #general ·{" "}
                    <strong className="font-semibold text-denied">blocked before dispatch</strong>
                  </span>
                </p>
              </div>
            </div>

            <Node title="Slack" detail="receives one post" />
          </div>
          <figcaption className="mt-4 border-t border-line pt-3 text-[13.5px] leading-[1.5] text-ink-soft">
            Authority sits between your agent and the tool. A call that fits the task goes through; one that
            does not never reaches Slack.
          </figcaption>
        </figure>
      </MarketingContainer>
    </section>
  );
}
