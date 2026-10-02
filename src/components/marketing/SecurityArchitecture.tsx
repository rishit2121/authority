import { HairlineDivider } from "@/components/marketing/HairlineDivider";
import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { SectionHeading } from "@/components/marketing/SectionHeading";

const POINTS = [
  {
    title: "Deterministic authority boundary",
    body: "A task's permitted tools, operations and resources are resolved by policy, not guessed by a model. The boundary is computed once, compiled into a contract, and checked the same way every time.",
  },
  {
    title: "Temporary capabilities",
    body: "Every permission is short-lived and scoped to one task. There is no standing grant left behind once the work is done.",
  },
  {
    title: "No standing agent credentials",
    body: "Agents never hold long-lived keys to the systems they act on. Each tool call is authorized individually, at the moment it happens.",
  },
  {
    title: "Complete decision trace",
    body: "Every allow, constraint, approval and denial is recorded — a full, auditable record of what an agent was permitted to do, and why.",
  },
];

export function SecurityArchitecture() {
  return (
    <section id="security" className="py-20 md:py-28">
      <MarketingContainer>
        <SectionHeading title="The security model" />

        <div className="mt-12 grid grid-cols-1 gap-x-16 gap-y-10 md:grid-cols-2">
          {POINTS.map((point) => (
            <div key={point.title} className="flex flex-col gap-2">
              <h3 className="font-headline-lg text-[19px] font-semibold text-mkt-text">{point.title}</h3>
              <p className="text-[15px] leading-relaxed text-mkt-text-secondary">{point.body}</p>
            </div>
          ))}
        </div>

        <HairlineDivider className="my-10" />

        <p className="max-w-2xl text-[14px] leading-relaxed text-mkt-text-secondary">
          Authority can also use a model (Jev) to flag unusual or risky requests. This signal is{" "}
          <strong className="text-mkt-text">advisory only</strong> unless a workspace explicitly turns on
          enforcement — a model is never the security boundary itself. The deterministic contract above
          remains authoritative at all times.
        </p>
      </MarketingContainer>
    </section>
  );
}
