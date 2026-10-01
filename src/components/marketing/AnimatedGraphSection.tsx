import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { ScopeGraph } from "@/components/marketing/graph/ScopeGraph";

export function AnimatedGraphSection() {
  return (
    <section className="py-20 md:py-28">
      <MarketingContainer>
        <ScopeGraph />
      </MarketingContainer>
    </section>
  );
}
