/**
 * A typed, fetch-only walkthrough of one authorize-then-execute call,
 * for a TypeScript agent that wants exact request/response shapes rather
 * than importing the plain-JS wrapper (authority-client.mjs). Covers the
 * same two steps that wrapper automates: ask, then -- only if allowed --
 * run, through the correct execution endpoint.
 *
 *   npx tsx examples/agent/typescript-example.ts
 *
 * Reuse authority-client.mjs directly from TypeScript instead if you don't
 * need your own types -- it has no build step and works from either.
 */

interface AuthorizeRequest {
  taskId: string;
  tool: string;
  operation: string;
  resource?: string;
  arguments: Record<string, string | number | boolean | string[]>;
  idempotencyKey: string;
  maxUses?: number;
}

interface AuthorizeResponse {
  decisionId: string;
  status: "allow" | "allow_constrained" | "replan" | "clarify" | "require_approval" | "deny";
  reasonCodes: string[];
  summary: string;
  contract: { id: string; version: number | null } | null;
  requiresApproval: boolean;
  capability: {
    id: string;
    token: string | null;
    tokenAlreadyIssued: boolean;
    tool: string;
    operation: string;
    expiresAt: string;
    maxUses: number;
  } | null;
  approval: { id: string; state: string; statusUrl: string } | null;
  guidance: { nextStep: string; message: string };
}

interface ExecuteRequest {
  capability: string;
  tool: string;
  operation: string;
  resource: string;
  arguments: Record<string, string | number | boolean | string[]>;
  idempotencyKey: string;
}

interface ExecuteResponse {
  result: "succeeded" | "succeeded_noop";
  executionId: string;
  receiptId: string;
  execution: { mode: "mock" | "live"; simulated: boolean };
  resource: Record<string, unknown>;
  data: Record<string, unknown>;
  requestId: string;
}

interface ApiErrorBody {
  error: { code: string; message: string; reason?: string };
}

const AUTHORITY_URL = process.env.AUTHORITY_URL ?? "";
const AUTHORITY_RUNTIME_KEY = process.env.AUTHORITY_RUNTIME_KEY ?? "";
const AUTHORITY_TASK_ID = process.env.AUTHORITY_TASK_ID ?? "";

if (!AUTHORITY_URL || !AUTHORITY_RUNTIME_KEY || !AUTHORITY_TASK_ID) {
  console.error(
    "Set AUTHORITY_URL, AUTHORITY_RUNTIME_KEY and AUTHORITY_TASK_ID. See the Quickstart at /docs/quickstart.",
  );
  process.exit(2);
}

async function authorize(body: AuthorizeRequest): Promise<AuthorizeResponse> {
  const res = await fetch(`${AUTHORITY_URL}/api/v1/authorize`, {
    method: "POST",
    headers: { authorization: `Bearer ${AUTHORITY_RUNTIME_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json()) as ApiErrorBody;
    throw new Error(`authorize failed: ${err.error.code} -- ${err.error.message}`);
  }
  return res.json() as Promise<AuthorizeResponse>;
}

async function executeGithub(body: ExecuteRequest): Promise<ExecuteResponse | ApiErrorBody> {
  const res = await fetch(`${AUTHORITY_URL}/api/v1/github/execute`, {
    method: "POST",
    headers: { authorization: `Bearer ${AUTHORITY_RUNTIME_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main(): Promise<void> {
  const decision = await authorize({
    taskId: AUTHORITY_TASK_ID,
    tool: "github.get_issue",
    operation: "get_issue",
    resource: process.env.AUTHORITY_REPOSITORY ?? "owner/repo",
    arguments: { issue_number: "1" },
    idempotencyKey: `ts-example-${Date.now()}`,
  });

  console.log(`Decision: ${decision.status} (${decision.guidance.nextStep})`);
  if (decision.guidance.nextStep !== "proceed" || !decision.capability?.token) {
    console.log(decision.guidance.message);
    return;
  }

  const result = await executeGithub({
    capability: decision.capability.token,
    tool: "github.get_issue",
    operation: "get_issue",
    resource: process.env.AUTHORITY_REPOSITORY ?? "owner/repo",
    arguments: { issue_number: "1" },
    idempotencyKey: `ts-example-${Date.now()}`,
  });

  if ("error" in result) {
    console.log(`Execution refused: ${result.error.code} -- ${result.error.message}`);
    return;
  }
  console.log(
    `Executed (${result.execution.mode}${result.execution.simulated ? ", simulated" : ""}):`,
    result.data,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
