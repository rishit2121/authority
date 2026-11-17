import type { Metadata } from "next";

import { FinalCta } from "@/components/marketing/FinalCta";
import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { MarketingFieldLines } from "@/components/marketing/MarketingFieldLines";
import { OneTaskExactAuthority } from "@/components/marketing/OneTaskExactAuthority";
import { RuntimeTraceSection } from "@/components/marketing/RuntimeTraceSection";
import { SecurityArchitecture } from "@/components/marketing/SecurityArchitecture";
import { ThreeStepExplanation } from "@/components/marketing/ThreeStepExplanation";

export const metadata: Metadata = {
  title: "How Authority works",
  description:
    "The architecture behind Authority: task contracts compiled from trusted tools and policy, every tool call checked before it runs, temporary capabilities and a complete decision trace.",
};

/** The deeper architecture sections that used to sit on the home page, unchanged, behind one short intro. */
export default function HowItWorksPage() {
  return (
    <>
      <div className="relative isolate overflow-clip bg-paper">
        <MarketingFieldLines />
        <div className="relative z-[1]">
          <MarketingContainer className="pt-14 md:pt-20">
            <p className="font-mono-code text-[12px] uppercase tracking-[0.1em] text-ink-soft">
              Architecture
            </p>
            <h1 className="mt-3 max-w-3xl font-display-serif text-[clamp(2.5rem,5vw,4rem)] font-normal leading-[1] tracking-[-0.03em] text-ink">
              How Authority works
            </h1>
            <p className="mt-5 max-w-[36rem] text-[17px] leading-[1.6] text-ink-soft">
              Each task gets a contract: the tools it may use, the resources it may touch and how often. Every
              tool call is checked against that contract before it runs, and every decision is recorded.
            </p>
          </MarketingContainer>
          <OneTaskExactAuthority />
        </div>
      </div>
      <hr className="m-0 border-0 border-t border-mkt-hairline" />
      <ThreeStepExplanation />
      <RuntimeTraceSection />
      <SecurityArchitecture />
      <FinalCta link={{ label: "Try a protected call", href: "/#proof-run" }} />
    </>
  );
}
