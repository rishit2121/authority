import type { Metadata } from "next";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Errors and troubleshooting — Authority Docs" };

export default function ErrorsPage() {
  return (
    <DocsPage
      title="Errors and troubleshooting"
      description="Every response carries Cache-Control: no-store and an X-Request-Id — include that id if you need to ask for help with a specific call."
    >
      <DocsSection title="Response shape">
        <p>Most failures look like this:</p>
        <CodeBlock
          language="json"
          code={`{ "error": { "code": "SCOPE_MISMATCH", "reason": "scope_mismatch", "message": "...", "requestId": "..." } }`}
        />
        <p>
          <code>/api/v1/execute</code> and <code>/api/v1/github/execute</code> use a slightly different,
          flatter shape for execution-phase failures (the request reached a connector before failing):
        </p>
        <CodeBlock
          language="json"
          code={`{ "error": { "code": "...", "message": "..." }, "executionId": "...", "status": "released|failed|indeterminate",
  "receiptId": "...", "execution": { "mode": "mock|live", "simulated": true }, "requestId": "..." }`}
        />
        <p>
          A <strong>successful authorization is not the same as a successful execution</strong>. Authorize
          returning <code>allow</code> only means a capability was issued; the execute call can still fail
          (connector down, upstream rejected it, a write landed in an unknown state).
        </p>
      </DocsSection>

      <DocsSection title="Authentication and session errors">
        <DocsTable
          headers={["code", "HTTP", "Cause"]}
          rows={[
            [
              "UNAUTHENTICATED",
              "401",
              "Runtime key or session token missing, invalid, expired, or revoked — deliberately indistinguishable.",
            ],
            [
              "RATE_LIMITED",
              "429",
              "20+ failed attempts for the same key prefix within 60s. Retry-After: 60.",
            ],
            [
              "AGENT_TASK_MISMATCH",
              "403",
              "This key/session isn't bound to this task's agent (or a session was issued for a different task).",
            ],
            [
              "SESSION_CONTRACT_STALE",
              "409",
              "The task's active contract changed since this session was created — create a new session.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="Contract and scope errors">
        <DocsTable
          headers={["code / reasonCode", "Meaning"]}
          rows={[
            ["TASK_NOT_FOUND", "Unknown task, or belongs to another tenant."],
            ["NO_ACTIVE_CONTRACT", "This task has no currently active authority contract."],
            ["CONTRACT_NOT_CURRENTLY_ACTIVE", "The contract that was active has since expired."],
            ["TOOL_NOT_IN_CONTRACT", "This exact tool isn't part of the task's authorized action set."],
            [
              "CONSTRAINT_VIOLATION",
              "The arguments fall outside what the contract authorizes for this tool.",
            ],
            ["INVOCATION_LIMIT_REACHED", "The use budget for this task or action is exhausted."],
          ]}
        />
      </DocsSection>

      <DocsSection title="Capability errors">
        <DocsTable
          headers={["code", "HTTP", "Meaning"]}
          rows={[
            ["CAPABILITY_NOT_FOUND", "404", "Unknown token, or issued to a different agent/tenant."],
            [
              "SCOPE_MISMATCH",
              "403",
              "The tool/operation/resource/arguments at execute time don't match what was authorized.",
            ],
            ["CAPABILITY_ALREADY_USED", "409", "No uses left — this is a replay of an exhausted capability."],
            ["CAPABILITY_EXPIRED", "409", "Past its expiresAt."],
            ["CAPABILITY_REVOKED", "409", "Revoked by the agent, an admin, or the system."],
            ["IDEMPOTENCY_CONFLICT", "409", "Same idempotencyKey, different request content."],
          ]}
        />
      </DocsSection>

      <DocsSection title="Execution errors">
        <DocsTable
          headers={["code", "HTTP", "Meaning"]}
          rows={[
            [
              "OPERATION_NOT_SUPPORTED",
              "501/400",
              "No connector registered for this tool (or a github.* tool sent to the generic execute endpoint).",
            ],
            ["CONNECTOR_NOT_CONFIGURED", "503", "This tenant hasn't connected this connector."],
            ["CONNECTION_UNAVAILABLE", "403", "The tenant's connection is disconnected or unusable."],
            ["EXECUTION_IN_PROGRESS", "409", "A reservation for this idempotency key is already in flight."],
            [
              "EXECUTION_INDETERMINATE",
              "504",
              "The write's outcome is unknown. Never retried automatically — ask a human to check before doing anything else.",
            ],
            [
              "EXECUTION_STATE_UNKNOWN",
              "503",
              "The operation ran but the receipt couldn't be recorded. Do not retry.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="Rate limiting and availability">
        <DocsTable
          headers={["code", "HTTP", "Meaning"]}
          rows={[
            ["RATE_LIMITED", "429", "Retry-After header tells you when."],
            [
              "GATEWAY_UNAVAILABLE",
              "503",
              "The authorization gateway's database is unreachable — fails closed, Retry-After: 5.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="If an operation you expect is missing from the tool manifest">
        <p>
          Check (in order): the task has an <strong>active</strong> contract, not just a proposed one; the
          operation is actually listed in that contract&apos;s allowed actions; for Custom API/PostgreSQL, the
          operation is <strong>published</strong>, not a draft. See{" "}
          <a href="/docs/tool-filtering">Tool filtering</a>.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
