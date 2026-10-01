import { HairlineDivider } from "@/components/marketing/HairlineDivider";
import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { SectionHeading } from "@/components/marketing/SectionHeading";

const REQUIRED = [
  "PostgreSQL — read order #4821",
  "Stripe — read payment",
  "Stripe — refund the exact charge",
  "Gmail — email the order’s customer",
];

const NOT_REQUIRED = ["Slack — send message", "GitHub — modify repository", "Other customer records"];

export function OneTaskExactAuthority() {
  return (
    <section id="product" className="py-20 md:py-28">
      <MarketingContainer>
        <SectionHeading title="One task. Exact authority." />

        <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <span className="text-[13px] font-medium uppercase tracking-wider text-mkt-text-secondary">
              Task
            </span>
            <p className="mt-3 text-[19px] leading-snug text-mkt-text">
              Refund order #4821 and email the customer a confirmation.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            <div>
              <span className="text-[13px] font-medium uppercase tracking-wider text-mkt-green">
                Required
              </span>
              <ul className="mt-3 flex flex-col">
                {REQUIRED.map((item, index) => (
                  <li key={item}>
                    {index > 0 ? <HairlineDivider /> : null}
                    <p className="py-2.5 text-[15px] text-mkt-text">{item}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <span className="text-[13px] font-medium uppercase tracking-wider text-mkt-gray">
                Not required
              </span>
              <ul className="mt-3 flex flex-col">
                {NOT_REQUIRED.map((item, index) => (
                  <li key={item}>
                    {index > 0 ? <HairlineDivider /> : null}
                    <p className="py-2.5 text-[15px] text-mkt-gray line-through decoration-mkt-gray/50">
                      {item}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </MarketingContainer>
    </section>
  );
}
