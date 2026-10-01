import { AnimatedGraphSection } from "@/components/marketing/AnimatedGraphSection";
import { FinalCta } from "@/components/marketing/FinalCta";
import { Hero } from "@/components/marketing/Hero";
import { OneTaskExactAuthority } from "@/components/marketing/OneTaskExactAuthority";
import { RuntimeTraceSection } from "@/components/marketing/RuntimeTraceSection";
import { SecurityArchitecture } from "@/components/marketing/SecurityArchitecture";
import { ThreeStepExplanation } from "@/components/marketing/ThreeStepExplanation";

export default function HomePage() {
  return (
    <>
      <Hero />
      <AnimatedGraphSection />
      <OneTaskExactAuthority />
      <ThreeStepExplanation />
      <RuntimeTraceSection />
      <SecurityArchitecture />
      <FinalCta />
    </>
  );
}
