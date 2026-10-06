import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AccessManagementPanel,
  type AccessConnectionRow,
  type AccessCredentialRow,
} from "@/components/application/AccessManagementPanel";
import type { ConnectionAccessScope } from "@/app/app/settings/applications/actions";
import { CodeBlock } from "@/components/docs/CodeBlock";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = { title: "Get started" };

type Readiness = "configured" | "verified" | "missing_credentials" | "requires_consent" | "ready_to_run";

const READINESS_LABEL: Record<Readiness, string> = {
  configured: "Configured",
  verified: "Verified",
  missing_credentials: "Missing credentials",
  requires_consent: "Requires consent",
  ready_to_run: "Ready to run",
};

const READINESS_TONE: Record<Readiness, StatusTone> = {
  configured: "neutral",
  verified: "positive",
  missing_credentials: "negative",
  requires_consent: "attention",
  ready_to_run: "positive",
};

function ReadinessPill({ state }: { state: Readiness }) {
  return <StatusPill tone={READINESS_TONE[state]}>{READINESS_LABEL[state]}</StatusPill>;
}

function Step({
  number,
  title,
  state,
  children,
}: {
  number: number;
  title: string;
  state: Readiness;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-line bg-paper-raised p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-high text-[12px] text-ink-soft">
            {number}
          </span>
          {title}
        </h2>
        <ReadinessPill state={state} />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function GetStartedPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  const { identity, context } = await createRepositoriesForCurrentTenant(
    `/app/settings/applications/${applicationId}/get-started`,
  );

  const { data: application } = await context.supabase
    .from("applications")
    .select("id, name, slug, environment")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application || !identity.tenant.tenantId) notFound();

  const [credentialsResult, connectionsResult, accessPoliciesResult, automationPoliciesResult] =
    await Promise.all([
      context.supabase
        .from("developer_backend_credentials")
        .select("id, key_prefix, status, can_manage_access")
        .eq("application_id", applicationId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("connector_connections")
        .select("id, connector_id, status, verified_account_ref")
        .eq("owner_kind", "organization")
        .neq("status", "disconnected")
        .order("created_at", { ascending: false }),
      context.supabase
        .from("application_connection_access_policies")
        .select("connection_id, scope")
        .eq("application_id", applicationId),
      context.supabase
        .from("automation_policies")
        .select("tool")
        .eq("application_id", applicationId)
        .is("revoked_at", null),
    ]);

  const activeCredentials = (credentialsResult.data ?? []).filter((c) => c.status === "active");
  const policyByConnection = new Map(
    (accessPoliciesResult.data ?? []).map((p) => [p.connection_id, p.scope as ConnectionAccessScope]),
  );
  const connections = connectionsResult.data ?? [];
  const configuredConnections = connections.filter(
    (c) => policyByConnection.get(c.id) && policyByConnection.get(c.id) !== "admin_only",
  );
  const automationCount = (automationPoliciesResult.data ?? []).length;

  const accessConnections: AccessConnectionRow[] = connections.map((c) => ({
    connectionId: c.id,
    connectorId: c.connector_id,
    verifiedAccountRef: c.verified_account_ref,
    scope: policyByConnection.get(c.id) ?? "admin_only",
  }));
  const accessCredentials: AccessCredentialRow[] = activeCredentials.map((c) => ({
    id: c.id,
    keyPrefix: c.key_prefix,
    canManageAccess: c.can_manage_access,
  }));

  const step1State: Readiness = activeCredentials.length > 0 ? "verified" : "missing_credentials";
  const step2State: Readiness =
    connections.length === 0
      ? "missing_credentials"
      : configuredConnections.length > 0
        ? "configured"
        : "requires_consent";
  const step3State: Readiness =
    automationCount > 0 || configuredConnections.length > 0 ? "configured" : "requires_consent";
  const overallReady = step1State === "verified" && step2State !== "missing_credentials";
  const step4State: Readiness = overallReady ? "ready_to_run" : "requires_consent";

  const snippet = `import { AuthorityBackendClient, AuthorityAgentClient } from "@authority/sdk";

const backend = new AuthorityBackendClient({
  baseUrl: process.env.AUTHORITY_URL!,
  apiKey: process.env.AUTHORITY_BACKEND_API_KEY!, // ${activeCredentials[0]?.key_prefix ?? "authority_dk_..."}
});

// 1. Resolve your application user by its own opaque external id -- never your Authority account.
const customer = await backend.customers.ensure({ externalId: user.id });

// 2. Reference an existing connection, or start one if this user needs to connect a provider account.
const { connections } = await backend.connections.list(customer.customerId);

// 3. Prepare a task from a plan -- "ready" activates automatically only within the policy you configured above.
const task = await backend.tasks.create({
  customerId: customer.customerId,
  agentId: process.env.AUTHORITY_AGENT_ID!,
  intent: "Describe what this task is for",
  connections: connections.map((c) => ({ connectorId: c.connectorId, connectionId: c.connectionId })),
});
const outcome = await backend.tasks.prepare(task.taskId, { plan: { schemaVersion: 1, nodes: [/* ... */] } });

// 4. Hand a narrowly scoped session to the agent -- never the backend credential above.
const agent = new AuthorityAgentClient({
  baseUrl: process.env.AUTHORITY_URL!,
  token: process.env.AUTHORITY_AGENT_RUNTIME_KEY!,
});
await agent.sessions.create({ taskId: task.taskId });
const manifest = await agent.tools.list(task.taskId);
const result = await agent.tools.execute({ taskId: task.taskId, tool: manifest.tools[0].tool, operation: "...", resource: "...", arguments: {} });
`;

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        eyebrow={application.environment}
        title={`Get started — ${application.name}`}
        description="Four steps, once. Advanced controls stay on this application's own settings page below."
        secondaryAction={{ label: "All settings", href: `/app/settings/applications/${applicationId}` }}
      />

      <Step number={1} title="Application" state={step1State}>
        <p className="text-[14px] text-ink-soft">
          {activeCredentials.length > 0
            ? `${activeCredentials.length} active backend credential${activeCredentials.length === 1 ? "" : "s"}. Never ship this to a browser.`
            : "No backend credential yet -- your application backend needs one to call the developer API at all."}
        </p>
        <Link
          href={`/app/settings/applications/${applicationId}#credentials`}
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
        >
          {activeCredentials.length > 0 ? "Manage credentials" : "Create a backend credential"}
          <Icon name="arrow_forward" size={14} />
        </Link>
      </Step>

      <Step number={2} title="Connections" state={step2State}>
        <p className="text-[14px] text-ink-soft">
          {connections.length === 0
            ? "No connection exists yet for this tenant. Connect at least one provider account."
            : `${connections.length} connection${connections.length === 1 ? "" : "s"} available; ${configuredConnections.length} configured for customer access (self-service or shared) on this application.`}
        </p>
        <Link
          href="/app/integrations"
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
        >
          {connections.length === 0 ? "Connect a provider" : "Manage connections"}
          <Icon name="arrow_forward" size={14} />
        </Link>
      </Step>

      <Step number={3} title="Access and approvals" state={step3State}>
        <p className="text-[14px] text-ink-soft">
          Two separate decisions, both made once here. <strong>Who may use a connection</strong>: pick{" "}
          <strong>Backend-grantable</strong> to let your own backend grant/revoke individual customers from
          code with no dashboard click per signup, or <strong>Application-shared</strong> when every customer
          of this application should simply have access with no per-customer grant at all (e.g. a shared team
          Slack or Stripe account) -- leave <strong>Admin only</strong> for anything you&apos;d rather keep
          granting by hand. <strong>Which tools may auto-activate</strong>: allow-list a tool below only once
          its contract&apos;s own freshly-recomputed approval requirement is independently empty -- a tool
          that genuinely needs approval is never auto-activated merely because it&apos;s allow-listed.
        </p>
        <p className="mt-2 text-[14px] text-ink-soft">
          {automationCount > 0
            ? `${automationCount} tool${automationCount === 1 ? "" : "s"} allow-listed for automatic activation.`
            : "No tool is allow-listed yet -- every eligible task will wait for a human approval until you configure this."}
        </p>
        <div className="mt-4">
          <AccessManagementPanel
            applicationId={applicationId}
            connections={accessConnections}
            credentials={accessCredentials}
          />
        </div>
        <Link
          href={`/app/settings/applications/${applicationId}#automation`}
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
        >
          Configure tool allow-listing
          <Icon name="arrow_forward" size={14} />
        </Link>
      </Step>

      <Step number={4} title="Run your agent" state={step4State}>
        <p className="text-[14px] text-ink-soft">
          {overallReady
            ? "Copy this into your backend. Replace the placeholders with real values from step 1."
            : "This snippet will work once steps 1–2 above are configured -- shown now so you know exactly what to build toward."}
        </p>
        <div className="mt-3">
          <CodeBlock language="typescript" code={snippet} data-testid="get-started-snippet" />
        </div>
        <p className="mt-3 text-[13px] text-ink-soft">
          Not published to npm yet -- <code className="font-mono-code">@authority/sdk</code> is installed from
          this repo (<code className="font-mono-code">npm run sdk:build</code>) until a package publication is
          separately authorized. See{" "}
          <Link href="/docs/task-lifecycle" className="text-primary hover:underline">
            the task lifecycle docs
          </Link>{" "}
          for the full reference.
        </p>
      </Step>
    </div>
  );
}
