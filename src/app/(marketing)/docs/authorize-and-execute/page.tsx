import type { Metadata } from "next";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Authorize and execute — Authority Docs" };

const AUTHORIZE_REQUEST = `curl -s -X POST "$AUTHORITY_URL/api/v1/authorize" \\
  -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "taskId": "'"$AUTHORITY_TASK_ID"'",
    "tool": "github.get_issue",
    "operation": "get_issue",
    "resource": "'"$AUTHORITY_REPOSITORY"'",
    "arguments": { "issue_number": "1" },
    "idempotencyKey": "demo-get-issue-1"
  }'`;

const AUTHORIZE_RESPONSE = `{
  "decisionId": "f9b6...",
  "status": "allow",
  "reasonCodes": ["WITHIN_CONTRACT"],
  "summary": "Allowed: github.get_issue is within the active contract.",
  "contract": { "id": "c1a2...", "version": 3 },
  "remainingInvocations": 9,
  "requiresApproval": false,
  "requiresClarification": false,
  "requiresReplan": false,
  "wasReplayed": false,
  "enforcement": { "mode": "enforce", "degraded": false, "narrowedBySecurityPolicy": false },
  "capability": {
    "id": "7e21...",
    "token": "authcap_v1_AbCd...",
    "tokenAlreadyIssued": false,
    "tool": "github.get_issue",
    "operation": "get_issue",
    "expiresAt": "2026-10-02T10:05:00.000Z",
    "maxUses": 1
  },
  "approval": null,
  "guidance": { "nextStep": "proceed", "message": "Proceed with the authorized call." },
  "simulation": false
}`;

const EXECUTE_GITHUB_REQUEST = `curl -s -X POST "$AUTHORITY_URL/api/v1/github/execute" \\
  -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "capability": "authcap_v1_AbCd...",
    "tool": "github.get_issue",
    "operation": "get_issue",
    "resource": "'"$AUTHORITY_REPOSITORY"'",
    "arguments": { "issue_number": "1" },
    "idempotencyKey": "demo-get-issue-1"
  }'`;

const EXECUTE_RESPONSE = `{
  "result": "succeeded",
  "executionId": "a1b2...",
  "receiptId": "9f3c...",
  "execution": { "mode": "mock", "simulated": true },
  "resource": { "repository": "your-org/throwaway-repo", "issueNumber": 1 },
  "data": { "number": 1, "title": "Example issue", "state": "open" },
  "requestId": "req_..."
}`;

export default function AuthorizeAndExecutePage() {
  return (
    <DocsPage
      title="Authorize and execute"
      description="Two calls, always in this order: ask for permission, then — only if it was granted — run the operation through Authority's own connector."
    >
      <DocsSection title="Step 1 — POST /api/v1/authorize">
        <p>
          Every call starts here. A refusal is a normal <code>200</code> response with a status like{" "}
          <code>deny</code> or <code>require_approval</code> — not an HTTP error. Only network/auth/validation
          failures (bad key, malformed body, rate limit) return a non-2xx status.
        </p>
        <CodeBlock code={AUTHORIZE_REQUEST} language="bash" />
        <p>Request fields:</p>
        <DocsTable
          headers={["Field", "Required", "Notes"]}
          rows={[
            ["taskId", "yes", "UUID of the task this call is for."],
            [
              "tool",
              "yes",
              <code key="t">provider.operation</code>,
              " e.g. ",
              <code key="t2">github.get_issue</code>,
            ],
            ["operation", "yes", "1–100 chars."],
            ["resource", "no", "1–200 chars. Required at execute time even when omitted here."],
            ["arguments", "no", "Flat object of string/number/boolean/string[] values. Default {}."],
            ["idempotencyKey", "yes", "1–200 chars. Scoped to (task, key) — see below."],
            ["maxUses", "no", "Integer 1–5, default 1."],
            ["planNodeId", "no", "UUID, if this call corresponds to a specific plan node."],
          ]}
        />
        <p>Response (abbreviated):</p>
        <CodeBlock code={AUTHORIZE_RESPONSE} language="json" />
        <p>
          Follow <code>guidance.nextStep</code>, not <code>status</code>, to decide what to do:{" "}
          <code>proceed</code>, <code>request_approval</code>, <code>replan</code>, <code>clarify</code>,{" "}
          <code>retry_later</code>, or <code>stop</code>. See{" "}
          <a href="/docs/approvals-and-replanning">Approvals and replanning</a> for the non-
          <code>proceed</code> paths.
        </p>
      </DocsSection>

      <DocsSection title="Step 2 — execute, through the correct connector endpoint">
        <p>
          GitHub tools use their own dedicated route; every other connector (Stripe, Gmail, Slack, PostgreSQL,
          Custom API) uses the generic one. Sending a GitHub tool to the generic route, or vice versa, returns{" "}
          <code>501 OPERATION_NOT_SUPPORTED</code>.
        </p>
        <DocsTable
          headers={["Tool prefix", "Execute endpoint"]}
          rows={[
            [<code key="1">github.*</code>, <code key="1b">POST /api/v1/github/execute</code>],
            [
              <>
                everything else (<code>stripe.*</code>, <code>gmail.*</code>, <code>slack.*</code>,{" "}
                <code>postgres_*.*</code>, <code>custom_*.*</code>)
              </>,
              <code key="2b">POST /api/v1/execute</code>,
            ],
          ]}
        />
        <CodeBlock code={EXECUTE_GITHUB_REQUEST} language="bash" />
        <p>
          <code>capability</code> comes from the authorize response; <code>tool</code>, <code>operation</code>
          , and <code>arguments</code> must match exactly what you authorized, or the request is rejected with{" "}
          <code>RESOURCE_MISMATCH</code> or <code>ARGUMENTS_INVALID</code> before anything is dispatched
          upstream. Unlike authorize, <code>resource</code> is required here.
        </p>
        <CodeBlock code={EXECUTE_RESPONSE} language="json" />
        <p>
          <code>execution.mode</code> is <code>live</code> only in a production deployment; everywhere else
          (including local development) it is <code>mock</code> with <code>simulated: true</code> — the
          request still runs through the real connector code path and is recorded identically, just without
          reaching the real external API.
        </p>
      </DocsSection>

      <DocsSection title="Idempotency">
        <p>
          <code>idempotencyKey</code> is required on every authorize/execute call and is scoped to{" "}
          <code>(taskId, idempotencyKey)</code>. Repeating the same key with the same content replays the
          original outcome instead of running it again — on execute, the replay response is{" "}
          <code>&#123; replayed: true, executionId, status, execution, receipt &#125;</code>; the original{" "}
          <code>data</code> payload is <strong>not</strong> stored, so a client that loses a successful
          response must authorize a fresh capability to read the result again, not replay its way to it.
          Repeating the same key with <em>different</em> content is rejected outright with{" "}
          <code>409 IDEMPOTENCY_CONFLICT</code>.
        </p>
      </DocsSection>

      <DocsSection title="Failure after dispatch: indeterminate, never auto-retried">
        <p>
          If a write&apos;s outcome is unknown — a timeout after the request left Authority, a crash mid-call
          — the result settles as <code>indeterminate</code> (<code>HTTP 504</code>,{" "}
          <code>EXECUTION_INDETERMINATE</code>), never silently retried. A write must never be assumed safe to
          retry just because the response didn&apos;t arrive.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
