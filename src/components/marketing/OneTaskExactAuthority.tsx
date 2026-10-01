import { MarketingContainer } from "@/components/marketing/MarketingContainer";

const GRANTED = [
  { service: "PostgreSQL", lines: ["Read order #4821"] },
  { service: "Stripe", lines: ["Read its payment", "Refund the exact charge"] },
  { service: "Gmail", lines: ["Email that order’s customer"] },
];

const NOT_GRANTED = [
  "Other customer records",
  "Different refund amounts",
  "GitHub repository access",
  "Slack messaging",
  "Standing credentials",
];

export function OneTaskExactAuthority() {
  return (
    <section id="product" className="relative py-20 md:py-28">
      <MarketingContainer>
        <span className="font-mono-code text-[12px] uppercase tracking-[0.1em] text-ink-soft">
          One task. Exact authority.
        </span>

        <h2 className="mt-4 max-w-2xl font-display-serif text-[clamp(2.25rem,3.6vw,3.25rem)] font-normal leading-[1.05] tracking-[-0.02em] text-ink">
          The plan can ask.
          <br />
          The contract decides.
        </h2>

        <p className="mt-6 max-w-xl text-[16px] leading-[1.6] text-ink-soft">
          Authority resolves each proposed action against trusted tools, company policy, and the resources
          named in the task.
        </p>

        <div className="mt-16 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-0">
          <div className="md:pr-10">
            <span className="font-mono-code text-[11px] uppercase tracking-wide text-ink-soft">
              01 / Task
            </span>
            <p className="mt-4 text-[20px] leading-snug text-ink">
              Refund order #4821 and email the customer a confirmation.
            </p>
          </div>

          <div className="flex flex-col gap-4 md:border-l md:border-line md:px-10">
            <span className="font-mono-code text-[11px] uppercase tracking-wide text-ink-soft">
              02 / Granted
            </span>
            <ul className="flex flex-col gap-4">
              {GRANTED.map((item) => (
                <li key={item.service}>
                  <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
                    <span aria-hidden="true" className="text-[8px] text-signal">
                      ●
                    </span>
                    {item.service}
                  </div>
                  {item.lines.map((line) => (
                    <p key={line} className="pl-[14px] text-[14px] leading-snug text-ink-soft">
                      {line}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-4 md:border-l md:border-line md:px-10">
            <span className="font-mono-code text-[11px] uppercase tracking-wide text-ink-soft">
              03 / Not granted
            </span>
            <ul className="flex flex-col gap-3">
              {NOT_GRANTED.map((item) => (
                <li key={item} className="flex items-center gap-2 text-[14px] text-ink-soft">
                  <span aria-hidden="true" className="text-[8px] text-denied">
                    ●
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </MarketingContainer>
    </section>
  );
}
