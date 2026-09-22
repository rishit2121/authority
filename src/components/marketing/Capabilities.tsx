import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

const CAPABILITIES = [
  {
    title: "Task-scoped authorization",
    body: "Grant capabilities tied specifically to the bounded prompt lifecycle instead of long-lived machine service accounts or personal tokens.",
  },
  {
    title: "Independent plan validation",
    body: "Analyze agent-generated plans in an isolated control plane to detect hallucinations, goal hijacks, and unauthorized lateral movement.",
  },
  {
    title: "Ephemeral capabilities",
    body: "Auto-expiring cryptographic tokens minted just-in-time with strict argument constraints and automatic immediate revocation on task completion.",
  },
  {
    title: "Runtime enforcement gateway",
    body: "High-performance proxy interposed across Model Context Protocol (MCP), REST, GraphQL, and database drivers with sub-millisecond overhead.",
  },
  {
    title: "Human approval routing",
    body: "Escalate only the requests that genuinely exceed verified task boundaries, eliminating routine notification fatigue for security teams.",
  },
  {
    title: "Cryptographic decision traces",
    body: "Every allow, block, and replan is sealed into an immutable, verifiable audit trail suited for SOC2 Type II and FedRAMP compliance.",
  },
];

export function Capabilities() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Platform Primitives"
        title="Engineered for zero-trust runtime environments."
        className="max-w-2xl mb-space-2xl"
      />

      <div className="grid grid-cols-1 gap-space-lg md:grid-cols-2">
        {CAPABILITIES.map((capability, index) => (
          <Panel key={capability.title} interactive>
            <div className="mb-space-sm font-mono-token text-[11px] uppercase text-primary">
              CAPABILITY {String(index + 1).padStart(2, "0")}
            </div>
            <h3 className="mb-space-sm font-headline-sm text-headline-sm font-semibold text-on-surface">
              {capability.title}
            </h3>
            <p className="font-body-md text-body-md text-on-surface-variant">{capability.body}</p>
          </Panel>
        ))}
      </div>
    </Section>
  );
}
