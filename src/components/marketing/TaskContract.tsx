import { CodeBlock, CodeDeny, CodeKey, CodePlain, CodeString, CodeValue } from "@/components/ui/CodeBlock";
import { CodeWindow } from "@/components/ui/CodeWindow";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function TaskContract() {
  return (
    <Section>
      <SectionHeading
        align="center"
        eyebrow="Policy Primitives"
        title="Define what the task may do before the agent acts."
        description="Declarative Task Authority Contracts specify temporary perimeter boundaries that automatically collapse when the job is done."
        className="mx-auto max-w-2xl mb-space-2xl"
      />

      <CodeWindow
        filename="contract_payments_fix.json"
        meta="SPEC_VERSION 1.4"
        icon="data_object"
        className="mx-auto max-w-3xl bg-surface-container-low shadow-2xl"
      >
        <CodeBlock>
          {"{\n  "}
          <CodeKey>&quot;contract_id&quot;</CodeKey>
          {": "}
          <CodeString>&quot;tac_81920_pay_fix&quot;</CodeString>
          {",\n  "}
          <CodeKey>&quot;agent&quot;</CodeKey>
          {": {\n    "}
          <CodeKey>&quot;id&quot;</CodeKey>
          {": "}
          <CodePlain>&quot;coding-agent-17&quot;</CodePlain>
          {",\n    "}
          <CodeKey>&quot;model&quot;</CodeKey>
          {": "}
          <CodePlain>&quot;claude-opus-5&quot;</CodePlain>
          {"\n  },\n  "}
          <CodeKey>&quot;allowed_actions&quot;</CodeKey>
          {": [\n    "}
          <CodeString>&quot;github.read_repository&quot;</CodeString>
          {",\n    "}
          <CodeString>&quot;github.create_branch&quot;</CodeString>
          {",\n    "}
          <CodeString>&quot;github.push_commit&quot;</CodeString>
          {",\n    "}
          <CodeString>&quot;github.create_pull_request&quot;</CodeString>
          {"\n  ],\n  "}
          <CodeKey>&quot;resource_constraints&quot;</CodeKey>
          {": {\n    "}
          <CodeKey>&quot;repository&quot;</CodeKey>
          {": "}
          <CodePlain>&quot;org/payments-api&quot;</CodePlain>
          {",\n    "}
          <CodeKey>&quot;branch_pattern&quot;</CodeKey>
          {": "}
          <CodePlain>&quot;fix-*&quot;</CodePlain>
          {",\n    "}
          <CodeKey>&quot;max_changed_files&quot;</CodeKey>
          {": "}
          <CodeValue>4</CodeValue>
          {"\n  },\n  "}
          <CodeKey>&quot;forbidden_resources&quot;</CodeKey>
          {": [\n    "}
          <CodeDeny>&quot;org/payments-api:repository_secrets&quot;</CodeDeny>
          {",\n    "}
          <CodeDeny>&quot;aws:ssm:*&quot;</CodeDeny>
          {",\n    "}
          <CodeDeny>&quot;database:prod:*&quot;</CodeDeny>
          {"\n  ],\n  "}
          <CodeKey>&quot;ephemeral_limits&quot;</CodeKey>
          {": {\n    "}
          <CodeKey>&quot;max_tool_invocations&quot;</CodeKey>
          {": "}
          <CodeValue>12</CodeValue>
          {",\n    "}
          <CodeKey>&quot;expires_in_seconds&quot;</CodeKey>
          {": "}
          <CodeValue>600</CodeValue>
          {"\n  }\n}"}
        </CodeBlock>
      </CodeWindow>
    </Section>
  );
}
