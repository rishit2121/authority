import type { Metadata } from "next";

import { ActionFlow } from "@/components/marketing/ActionFlow";
import { FinalCta } from "@/components/marketing/FinalCta";
import { Hero } from "@/components/marketing/Hero";
import { CodeExample, ConnectorList, RunDetail, SetupSteps } from "@/components/marketing/home/HomeSections";
import { ProofRunSection } from "@/components/marketing/proof-run/ProofRunSection";

export const metadata: Metadata = {
  title: { absolute: "Authority — Give your agent tools. Set the limits." },
  description:
    "Decide what an agent can do for each task. Authority checks the tool, the destination and the usage limit before the call runs. Try a protected call: one Slack post allowed, everything else blocked before dispatch.",
};

/**
 * The home page is one scenario end to end: "Post one update in #engineering. Don't email anyone." The deeper
 * architecture sections live on /how-it-works.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <ActionFlow />
      <ProofRunSection />
      <hr className="m-0 border-0 border-t border-line" />
      <SetupSteps />
      <ConnectorList />
      <CodeExample />
      <RunDetail />
      <hr className="m-0 border-0 border-t border-line" />
      <FinalCta />
    </>
  );
}
