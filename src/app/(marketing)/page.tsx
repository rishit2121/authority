import { FinalCta } from "@/components/marketing/FinalCta";
import { Hero } from "@/components/marketing/Hero";
import { MarketingFieldLines } from "@/components/marketing/MarketingFieldLines";
import { OneTaskExactAuthority } from "@/components/marketing/OneTaskExactAuthority";
import { RuntimeTraceSection } from "@/components/marketing/RuntimeTraceSection";
import { SecurityArchitecture } from "@/components/marketing/SecurityArchitecture";
import { ThreeStepExplanation } from "@/components/marketing/ThreeStepExplanation";

export default function HomePage() {
  return (
    <>
      {/* One shared decorative line system behind both the hero and the section right after it,
          so the two read as one continuous composition — isolate+clip confines the lines to this
          wrapper's own box (clipped only at its outer edges, never mid-graph), and every real
          child is lifted above it with z-1. */}
      <div className="relative isolate overflow-clip bg-paper">
        <MarketingFieldLines />
        <div className="relative z-[1]">
          <Hero />
          <OneTaskExactAuthority />
        </div>
      </div>
      {/* The one full-width hairline on the page before the next major section — everywhere else,
          dividers are container-scoped. This is deliberately the moment the field-line composition
          ends. */}
      <hr className="m-0 border-0 border-t border-mkt-hairline" />
      <ThreeStepExplanation />
      <RuntimeTraceSection />
      <SecurityArchitecture />
      <FinalCta />
    </>
  );
}
