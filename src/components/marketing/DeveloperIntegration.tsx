import { CodeBlock, CodeComment, CodeDeny, CodeKeyword, CodeString } from "@/components/ui/CodeBlock";
import { CodeWindow } from "@/components/ui/CodeWindow";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

const AUDIT_CHECKS = [
  "Task intent matches requested git branch",
  'Repository "payments-api" explicitly allowed',
  "Main/master branch protection preserved",
  "Capability token TTL: 10 minutes maximum",
  "Max tool invocations capped: 1 execution",
];

export function DeveloperIntegration() {
  return (
    <Section variant="band" id="docs">
      <SectionHeading
        eyebrow="SDK & Runtime Gateway"
        title="Three lines of code to enforce least-privilege."
        description="Wrap your existing LangChain, LlamaIndex, or native model loops with deterministic verification."
        className="max-w-2xl mb-space-2xl"
      />

      <div className="grid grid-cols-1 items-center gap-space-lg lg:grid-cols-12">
        <CodeWindow
          filename="agent_runtime.ts"
          meta="TypeScript / Node.js"
          className="bg-code-surface shadow-xl lg:col-span-7"
          bodyClassName="p-space-lg"
        >
          <CodeBlock>
            <CodeKeyword>import</CodeKeyword>
            {" { AuthorityClient } "}
            <CodeKeyword>from</CodeKeyword> <CodeString>&quot;@authority/runtime&quot;</CodeString>
            {";\n\n"}
            <CodeKeyword>const</CodeKeyword>
            {" authority = "}
            <CodeKeyword>new</CodeKeyword>
            {" AuthorityClient({\n  endpoint: process.env.AUTHORITY_GATEWAY_URL\n});\n\n"}
            <CodeComment>{"// Intercept proposed tool invocation before execution"}</CodeComment>
            {"\n"}
            <CodeKeyword>const</CodeKeyword>
            {" decision = "}
            <CodeKeyword>await</CodeKeyword>
            {" authority.authorize({\n  taskId: "}
            <CodeString>&quot;task_1842&quot;</CodeString>
            {",\n  agentId: "}
            <CodeString>&quot;coding-agent-17&quot;</CodeString>
            {",\n  tool: "}
            <CodeString>&quot;github.push_commit&quot;</CodeString>
            {",\n  resource: {\n    repository: "}
            <CodeString>&quot;payments-api&quot;</CodeString>
            {",\n    branch: "}
            <CodeString>&quot;fix-991&quot;</CodeString>
            {"\n  },\n  expectedEffect: "}
            <CodeString>&quot;repository_write&quot;</CodeString>
            {"\n});\n\n"}
            <CodeKeyword>if</CodeKeyword>
            {" (!decision.allowed) {\n  "}
            <CodeKeyword>throw new</CodeKeyword>
            {" Error("}
            <CodeDeny>{"`Execution blocked: ${decision.reason}`"}</CodeDeny>
            {");\n}"}
          </CodeBlock>
        </CodeWindow>

        <Panel className="lg:col-span-5">
          <h3 className="mb-space-md font-headline-sm text-headline-sm font-semibold text-on-surface">
            Runtime Verification Audit
          </h3>
          <ul className="space-y-space-md font-mono-code text-[12px]">
            {AUDIT_CHECKS.map((check) => (
              <li key={check} className="flex items-center gap-space-sm text-allow">
                <Icon name="check_circle" size={18} />
                <span>{check}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Section>
  );
}
