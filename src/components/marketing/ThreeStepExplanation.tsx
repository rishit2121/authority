import { HairlineDivider } from "@/components/marketing/HairlineDivider";
import { MarketingContainer } from "@/components/marketing/MarketingContainer";

const STEPS = [
  {
    number: "01",
    title: "Propose",
    body: "The agent describes how it intends to complete the task.",
  },
  {
    number: "02",
    title: "Compile",
    body: "Authority resolves the plan against trusted tools and computes the minimum valid scope.",
  },
  {
    number: "03",
    title: "Enforce",
    body: "Every tool call is checked against the active task contract before execution.",
  },
];

export function ThreeStepExplanation() {
  return (
    <section id="how-it-works" className="py-20 md:py-28">
      <MarketingContainer>
        <HairlineDivider />
        <div className="grid grid-cols-1 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <div
              key={step.number}
              className={`flex flex-col gap-4 py-10 md:py-14 ${
                index > 0 ? "border-t border-mkt-hairline md:border-l md:border-t-0" : ""
              } ${index > 0 ? "md:pl-10" : ""} ${index < STEPS.length - 1 ? "md:pr-10" : ""}`}
            >
              <span className="font-mono-code text-[13px] text-mkt-gray">{step.number}</span>
              <h3 className="font-headline-lg text-[22px] font-semibold text-mkt-text">{step.title}</h3>
              <p className="text-[15px] leading-relaxed text-mkt-text-secondary">{step.body}</p>
            </div>
          ))}
        </div>
        <HairlineDivider />
      </MarketingContainer>
    </section>
  );
}
