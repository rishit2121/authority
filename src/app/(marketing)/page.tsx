import { Capabilities } from "@/components/marketing/Capabilities";
import { DatabaseScoping } from "@/components/marketing/DatabaseScoping";
import { DeveloperIntegration } from "@/components/marketing/DeveloperIntegration";
import { FinalCta } from "@/components/marketing/FinalCta";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { ProblemStatement } from "@/components/marketing/ProblemStatement";
import { RuntimeInspector } from "@/components/marketing/RuntimeInspector";
import { SecurityArchitecture } from "@/components/marketing/SecurityArchitecture";
import { TaskContract } from "@/components/marketing/TaskContract";
import { TrustStrip } from "@/components/marketing/TrustStrip";
import { WrongPlanDemo } from "@/components/marketing/WrongPlanDemo";

export default function HomePage() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <ProblemStatement />
      <HowItWorks />
      <RuntimeInspector />
      <WrongPlanDemo />
      <TaskContract />
      <DatabaseScoping />
      <Capabilities />
      <DeveloperIntegration />
      <SecurityArchitecture />
      <FinalCta />
    </>
  );
}
