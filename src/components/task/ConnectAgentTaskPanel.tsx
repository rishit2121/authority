import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { StatusPill } from "@/components/ui/StatusPill";
import { isContractCurrentlyActive } from "@/lib/authorization/contract-runtime";
import type { TaskAuthorityContract } from "@/lib/domain/task-authority-contract";

export interface ConnectAgentTaskPanelProps {
  taskId: string;
  baseUrl: string;
  contract: TaskAuthorityContract | null;
  boundIntegrations: string[];
}

export function ConnectAgentTaskPanel({
  taskId,
  baseUrl,
  contract,
  boundIntegrations,
}: ConnectAgentTaskPanelProps) {
  const ready = contract ? isContractCurrentlyActive(contract) : false;
  const exampleAction = ready ? contract!.allowedActions[0] : null;
  const exampleTool = exampleAction?.tool ?? "<tool from the active contract>";
  const exampleOperation = exampleTool.includes(".")
    ? exampleTool.split(".").slice(1).join(".")
    : "<operation>";

  const envTemplate = `AUTHORITY_URL=${baseUrl}
AUTHORITY_AGENT_KEY=<set privately>
AUTHORITY_TASK_ID=${taskId}`;

  const curlExample = `curl -s -X POST "$AUTHORITY_URL/api/v1/authorize" \\
  -H "Authorization: Bearer $AUTHORITY_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "taskId": "'"$AUTHORITY_TASK_ID"'",
    "tool": "${exampleTool}",
    "operation": "${exampleOperation}",
    "arguments": {},
    "idempotencyKey": "example-1"
  }'`;

  const tsExample = `const res = await fetch(\`\${process.env.AUTHORITY_URL}/api/v1/authorize\`, {
  method: "POST",
  headers: {
    authorization: \`Bearer \${process.env.AUTHORITY_AGENT_KEY}\`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    taskId: process.env.AUTHORITY_TASK_ID,
    tool: "${exampleTool}",
    operation: "${exampleOperation}",
    arguments: {},
    idempotencyKey: "example-1",
  }),
});
const decision = await res.json();`;

  const pythonExample = `import os, requests

res = requests.post(
    f"{os.environ['AUTHORITY_URL']}/api/v1/authorize",
    headers={"Authorization": f"Bearer {os.environ['AUTHORITY_AGENT_KEY']}"},
    json={
        "taskId": os.environ["AUTHORITY_TASK_ID"],
        "tool": "${exampleTool}",
        "operation": "${exampleOperation}",
        "arguments": {},
        "idempotencyKey": "example-1",
    },
)
decision = res.json()`;

  return (
    <section
      aria-labelledby="connect-agent-task-heading"
      className="flex flex-col gap-3 rounded-[10px] border border-line bg-paper-raised p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="connect-agent-task-heading" className="text-[15px] font-semibold text-ink">
          Connect your agent
        </h2>
        <StatusPill tone={ready ? "positive" : "attention"}>
          {ready ? "Contract active" : "Contract not active"}
        </StatusPill>
      </div>

      <dl className="flex flex-col gap-1.5 text-[13px]">
        <div className="flex items-center gap-2">
          <dt className="w-32 shrink-0 font-label-caps text-[10px] uppercase tracking-wider text-outline">
            Task ID
          </dt>
          <dd className="font-mono-code text-ink">{taskId}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-32 shrink-0 font-label-caps text-[10px] uppercase tracking-wider text-outline">
            Bound integrations
          </dt>
          <dd className="text-ink-soft">
            {boundIntegrations.length > 0 ? boundIntegrations.join(", ") : "None yet"}
          </dd>
        </div>
      </dl>

      {!ready ? (
        <div
          role="note"
          className="rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink-soft"
        >
          {contract
            ? "This task's contract isn't active yet, so a real example would fail — review and activate it first."
            : "This task has no contract yet, so there's nothing to authorize against — propose and activate one to get a working example below."}{" "}
          The environment template and a runtime key can still be set up ahead of time.
        </div>
      ) : null}

      <p className="text-[13px] text-ink-soft">Environment template (never commit a real key):</p>
      <CodeBlock code={envTemplate} data-testid="connect-agent-env-template" />

      <p className="text-[13px] text-ink-soft">curl</p>
      <CodeBlock code={curlExample} language="bash" data-testid="connect-agent-curl" />

      <p className="text-[13px] text-ink-soft">TypeScript (fetch)</p>
      <CodeBlock code={tsExample} language="ts" data-testid="connect-agent-ts" />

      <p className="text-[13px] text-ink-soft">Python</p>
      <CodeBlock code={pythonExample} language="python" data-testid="connect-agent-python" />

      <div className="flex gap-3 text-[13px]">
        <Link href="/docs/quickstart" className="underline underline-offset-2">
          Full quickstart
        </Link>
        <Link href="/docs/authorize-and-execute" className="underline underline-offset-2">
          Authorize and execute
        </Link>
      </div>
    </section>
  );
}
