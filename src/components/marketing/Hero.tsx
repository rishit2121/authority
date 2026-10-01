import { AuthorityField } from "@/components/marketing/AuthorityField";
import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { PrimaryButton } from "@/components/marketing/PrimaryButton";
import { SecondaryButton } from "@/components/marketing/SecondaryButton";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden py-24 md:py-36">
      <AuthorityField />
      <MarketingContainer className="relative flex flex-col items-center text-center">
        <span className="font-headline-sm text-mkt-eyebrow uppercase tracking-wider text-mkt-indigo">
          Least-privilege control for AI agents
        </span>

        <h1 className="mt-5 max-w-4xl font-headline-lg text-mkt-display-mobile text-mkt-text md:text-mkt-display">
          Let agents act.
          <br />
          Keep authority bounded.
        </h1>

        <p className="mt-8 max-w-xl font-body-md text-mkt-body text-mkt-text-secondary">
          Authority turns a task and proposed plan into a temporary, verifiable contract—then checks every
          tool call at runtime.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <PrimaryButton href="/signup">Start with a task</PrimaryButton>
          <SecondaryButton href="/demo">View a live trace</SecondaryButton>
        </div>
      </MarketingContainer>
    </section>
  );
}
