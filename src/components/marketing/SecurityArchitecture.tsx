import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

function Connector() {
  return <span className="mx-auto h-6 w-0.5 bg-outline-variant/40" />;
}

export function SecurityArchitecture() {
  return (
    <Section id="security">
      <SectionHeading
        align="center"
        eyebrow="System Invariant"
        title="Models advise. Policy enforces."
        description="Never trust an LLM to self-enforce its boundaries. Authority places physical cryptographic guards outside the model execution container."
        className="mx-auto max-w-2xl mb-space-2xl"
      />

      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <div className="flex items-center justify-between rounded-lg border border-outline-variant/30 bg-surface-container p-space-md">
          <span className="font-headline-sm text-body-md font-semibold text-on-surface">
            1. User &amp; Validated Intent
          </span>
          <span className="font-mono-code text-[11px] text-allow">SOURCE_OF_TRUTH</span>
        </div>

        <Connector />

        <div className="flex flex-col justify-between gap-2 rounded-lg border border-error/30 bg-untrusted p-space-lg md:flex-row md:items-center">
          <div>
            <span className="block font-mono-token text-[10px] uppercase text-error">
              Untrusted execution boundary
            </span>
            <span className="font-headline-sm text-body-md font-semibold text-on-surface">
              Autonomous Agent Reasoning Loop (LLM)
            </span>
          </div>
          <span className="font-mono-code text-[11px] text-error">PROPOSES_ACTIONS_ONLY</span>
        </div>

        <Connector />

        <div className="flex flex-col justify-between gap-4 rounded-xl border-2 border-primary/50 bg-surface-container-high p-space-xl shadow-2xl md:flex-row md:items-center">
          <div>
            <span className="block font-mono-token text-[10px] font-bold uppercase text-primary">
              Authority enforcement substrate
            </span>
            <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Cryptographic Runtime Gateway
            </span>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
              Contract Synthesis · Policy Evaluation · JIT Credential Injection · Revocation
            </p>
          </div>
          <span className="shrink-0 rounded bg-primary px-3 py-1.5 font-mono-code text-[11px] font-medium text-on-primary">
            ZERO-TRUST MEDIATION
          </span>
        </div>

        <Connector />

        <div className="flex flex-col items-start justify-between gap-2 rounded-lg border border-outline-variant/30 bg-surface-container p-space-md sm:flex-row sm:items-center">
          <span className="font-headline-sm text-body-md font-semibold text-on-surface">
            External Tool APIs &amp; Datastores (GitHub, Databases, Slack)
          </span>
          <span className="font-mono-code text-[11px] text-outline">PROTECTED_TARGETS</span>
        </div>
      </div>
    </Section>
  );
}
