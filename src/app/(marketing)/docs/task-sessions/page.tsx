import type { Metadata } from "next";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Task sessions — Authority Docs" };

export default function TaskSessionsPage() {
  return (
    <DocsPage
      title="Task sessions"
      description="An optional, short-lived stand-in for your runtime key, scoped to one task. Use it so the long-lived key never has to leave wherever you keep it once your agent starts working — everything else about authorization is identical either way."
    >
      <DocsSection title="What a session is, and isn't">
        <p>
          A session is <strong>identity, not authority</strong>. Creating one proves nothing new was granted —
          every authorize call made with a session is checked against the task&apos;s real contract exactly as
          it would be with the runtime key directly. A session just lets you avoid presenting the long-lived
          key on every call: resolve it once, use the short-lived token for up to 15 minutes.
        </p>
        <p>
          Using a session is entirely optional. The runtime key continues to work everywhere, for every task,
          with no session at all — see <a href="/docs/authentication">Authentication</a>.
        </p>
      </DocsSection>

      <DocsSection title="Create a session">
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/sessions" \\
  -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "taskId": "'"$AUTHORITY_TASK_ID"'", "ttlSeconds": 900 }'`}
        />
        <p>Response:</p>
        <CodeBlock
          language="json"
          code={`{
  "sessionId": "b2c1...",
  "token": "authority_ts_AbCd...",
  "taskId": "...",
  "contract": { "id": "c1a2...", "version": 3 },
  "expiresAt": "2026-10-02T10:15:00.000Z"
}`}
        />
        <p>
          <code>token</code> is returned exactly once, the same way a runtime key is when it&apos;s issued —
          copy it immediately. The task must already have an active contract or this fails with{" "}
          <code>409 NO_ACTIVE_CONTRACT</code>.
        </p>
        <DocsTable
          headers={["Field", "Notes"]}
          rows={[
            ["taskId", "Required. The task this session is scoped to, for its whole lifetime."],
            [
              "ttlSeconds",
              "Optional, 60–900 (default 900). Never exceeds 15 minutes, regardless of what you ask for.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="Use it exactly like a runtime key">
        <p>
          Send it the same way, to the same endpoints — <code>Authorization: Bearer authority_ts_...</code>.
          Every authorize/execute/capability/approval call accepts either credential.
        </p>
        <CodeBlock
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/authorize" \\
  -H "Authorization: Bearer $SESSION_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "taskId": "'"$AUTHORITY_TASK_ID"'", "tool": "github.get_issue", "operation": "get_issue", ... }'`}
          language="bash"
        />
        <p>
          A session only ever authorizes calls for the exact task it was created for. Presenting it with a
          different <code>taskId</code> fails with <code>403 AGENT_TASK_MISMATCH</code>. If the task&apos;s
          active contract changes after the session was created (a new version activated, the old one
          revoked), the session is invalidated rather than silently carried onto the new contract —{" "}
          <code>409 SESSION_CONTRACT_STALE</code>. Either way, create a fresh session; the runtime key is
          unaffected by either failure.
        </p>
      </DocsSection>

      <DocsSection title="Check or end a session">
        <p>
          <code>GET /api/v1/sessions/current</code> introspects whichever session token you send — unlike
          every other endpoint, it gives a specific reason (expired, revoked, or its issuing credential/agent
          is no longer active) instead of a single collapsed &quot;unauthenticated&quot;:
        </p>
        <CodeBlock
          code={`curl -s "$AUTHORITY_URL/api/v1/sessions/current" -H "Authorization: Bearer $SESSION_TOKEN"`}
          language="bash"
        />
        <p>
          <code>POST /api/v1/sessions/revoke</code> ends it early, authenticated by the session token itself
          (not the runtime key) — the same &quot;you hold it, you can end it&quot; shape as revoking a
          capability. An empty body is fine; <code>reason</code> is optional. Idempotent.
        </p>
        <CodeBlock
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/sessions/revoke" -H "Authorization: Bearer $SESSION_TOKEN"`}
          language="bash"
        />
      </DocsSection>

      <DocsSection title="What invalidates a session">
        <DocsTable
          headers={["Event", "Effect on the session"]}
          rows={[
            ["Its 15-minute (or shorter) TTL elapses", "SESSION_EXPIRED on every subsequent call."],
            ["You call /sessions/revoke", "SESSION_REVOKED."],
            [
              "The issuing runtime key is revoked, or the agent is disabled",
              "SESSION_CREDENTIAL_REVOKED — a session is never more durable than the credential that created it.",
            ],
            [
              "The task's active contract changes (new version, or revoked)",
              "SESSION_CONTRACT_STALE on the next authorize call — never silently migrated onto the new contract.",
            ],
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}
