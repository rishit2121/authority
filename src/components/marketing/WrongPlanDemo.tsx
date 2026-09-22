import { CodeBlock, CodeDeny, CodeKey, CodeMuted, CodeString, CodeValue } from "@/components/ui/CodeBlock";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

const PROPOSED_PLAN = [
  { step: '1. gmail.search("from:acme-corp renewal")', justified: true },
  { step: '2. gmail.get_thread("thread_id_9901")', justified: true },
  { step: '3. dropbox.upload("acme_renewal.pdf")', justified: false },
];

export function WrongPlanDemo() {
  return (
    <Section variant="band">
      <SectionHeading
        eyebrow="Why Naive OAuth Fails"
        title="A minimal permission can still authorize the wrong plan."
        description="Traditional IAM checks if a token has valid syntax for a proposed call. Authority verifies whether the action itself is justified by the user's original prompt."
        className="max-w-3xl mb-space-2xl"
      />

      <div className="grid grid-cols-1 items-stretch gap-space-xl lg:grid-cols-2">
        <Panel className="flex flex-col justify-between">
          <div>
            <div className="mb-space-sm font-mono-token text-[11px] uppercase tracking-wider text-outline">
              Input Scenario
            </div>
            <div className="mb-space-lg rounded-lg border border-outline-variant/30 bg-surface-container-low p-space-md">
              <span className="mb-1 block font-mono-code text-[11px] text-outline">USER PROMPT:</span>
              <p className="font-body-md text-body-md font-medium text-on-surface">
                &ldquo;Summarize the latest customer email from Acme Corp regarding renewal terms.&rdquo;
              </p>
            </div>

            <span className="mb-space-sm block font-mono-code text-[11px] uppercase text-outline">
              Agent Proposed Plan:
            </span>
            <div className="space-y-space-sm font-mono-code text-[12px]">
              {PROPOSED_PLAN.map((entry) => (
                <div
                  key={entry.step}
                  className={`flex flex-col items-start justify-between gap-1 rounded border p-space-md sm:flex-row sm:items-center sm:gap-2 ${
                    entry.justified
                      ? "border-allow/30 bg-surface-container-low"
                      : "border-error/50 bg-error/5"
                  }`}
                >
                  <span className={entry.justified ? "text-on-surface" : "font-medium text-error"}>
                    {entry.step}
                  </span>
                  <span className={`shrink-0 font-bold ${entry.justified ? "text-allow" : "text-error"}`}>
                    {entry.justified ? "✓ JUSTIFIED" : "✕ UNJUSTIFIED"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-space-lg rounded border border-error/30 bg-error/10 p-space-md font-body-sm text-[12px] text-error">
            <strong>The Security Failure:</strong> Under standard IAM, if the agent has a connected Dropbox
            integration, the upload executes silently. Authority terminates this edge before execution.
          </div>
        </Panel>

        <div className="flex flex-col justify-between rounded-xl border border-outline-variant/30 bg-graph-canvas p-space-xl">
          <div>
            <div className="mb-space-md flex items-center justify-between border-b border-outline-variant/20 pb-space-sm">
              <span className="font-mono-token text-[11px] uppercase text-primary">
                Decision Engine Verdict
              </span>
              <span className="font-mono-code text-[11px] text-error">[PARTIAL_DENY // REPLAN]</span>
            </div>

            <CodeBlock className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-space-md">
              {`{\n  `}
              <CodeKey>&quot;task_id&quot;</CodeKey>
              {": "}
              <CodeString>&quot;task_99182&quot;</CodeString>
              {",\n  "}
              <CodeKey>&quot;decision&quot;</CodeKey>
              {": "}
              <CodeDeny>&quot;PARTIAL_ALLOW&quot;</CodeDeny>
              {",\n  "}
              <CodeKey>&quot;approved_actions&quot;</CodeKey>
              {": [\n    "}
              <CodeString>&quot;gmail.search&quot;</CodeString>
              {",\n    "}
              <CodeString>&quot;gmail.get_thread&quot;</CodeString>
              {"\n  ],\n  "}
              <CodeKey>&quot;rejected_actions&quot;</CodeKey>
              {": [\n    {\n      "}
              <CodeKey>&quot;tool&quot;</CodeKey>
              {": "}
              <CodeDeny>&quot;dropbox.upload&quot;</CodeDeny>
              {",\n      "}
              <CodeKey>&quot;violation&quot;</CodeKey>
              {": "}
              <CodeDeny>&quot;UNJUSTIFIED_EXTERNAL_EGRESS&quot;</CodeDeny>
              {",\n      "}
              <CodeKey>&quot;reason&quot;</CodeKey>
              {": "}
              <CodeMuted>
                &quot;User intent requested summary only; no persistent file upload was specified.&quot;
              </CodeMuted>
              {"\n    }\n  ],\n  "}
              <CodeKey>&quot;required_action&quot;</CodeKey>
              {": "}
              <CodeKey>&quot;AGENT_REPLAN&quot;</CodeKey>
              {",\n  "}
              <CodeKey>&quot;ephemeral_token_issued&quot;</CodeKey>
              {": "}
              <CodeValue>false</CodeValue>
              {"\n}"}
            </CodeBlock>
          </div>

          <div className="mt-space-lg flex items-center gap-2 font-mono-code text-[11px] text-outline">
            <Icon name="policy" size={16} className="text-primary" />
            <span>Enforced via deterministic task-boundary policy in 1.8ms</span>
          </div>
        </div>
      </div>
    </Section>
  );
}
