import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

interface Stage {
  step: string;
  title: string;
  body: string;
  token: string;
  tokenClass: string;
}

const STAGES: Stage[] = [
  {
    step: "01 // UNDERSTAND",
    title: "Task Contract",
    body: "Inbound user prompt is parsed to extract verifiable boundaries: target resources, permissible mutation types, and operational constraints.",
    token: "CONTRACT_SYNTHESIS",
    tokenClass: "text-primary",
  },
  {
    step: "02 // CROSS-REFERENCE",
    title: "Plan Verification",
    body: "The agent submits its proposed execution plan. The engine verifies every tool and argument against user intent and organizational guardrails.",
    token: "POLICY_GRAPH_MATCH",
    tokenClass: "text-secondary",
  },
  {
    step: "03 // GRANT",
    title: "Ephemeral Tokens",
    body: "Generates short-lived cryptographic capabilities (JWT/SPIFFE) scoped strictly to authorized endpoints and valid for minutes.",
    token: "DYNAMIC_CAPABILITY_MINT",
    tokenClass: "text-allow",
  },
  {
    step: "04 // ENFORCE",
    title: "Gateway Intercept",
    body: "Runtime gateway validates credentials just-in-time, performs the egress API call, drops standing privilege, and records deterministic audit traces.",
    token: "JIT_INJECT_REVOKE",
    tokenClass: "text-primary",
  },
];

export function HowItWorks() {
  return (
    <Section variant="band" id="how-it-works">
      <SectionHeading
        eyebrow="Enforcement Lifecycle"
        title="How runtime authorization works"
        description="A zero-trust mediation layer interposed between autonomous reasoning loops and physical infrastructure."
        className="max-w-2xl mb-space-2xl"
      />

      <ol className="relative grid grid-cols-1 gap-space-lg md:grid-cols-4">
        {STAGES.map((stage) => (
          <li
            key={stage.step}
            className="relative rounded-xl border border-outline-variant/30 bg-surface-container-low p-space-lg"
          >
            <div className="mb-space-md font-mono-token text-[12px] font-bold tracking-widest text-primary">
              {stage.step}
            </div>
            <h3 className="mb-space-sm font-headline-sm text-headline-sm font-semibold text-on-surface">
              {stage.title}
            </h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{stage.body}</p>
            <div
              className={`mt-space-lg rounded bg-surface-container-lowest p-2 font-mono-code text-[10px] ${stage.tokenClass}`}
            >
              {stage.token}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
