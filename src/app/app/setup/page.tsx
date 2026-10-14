import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { CONNECTOR_CATALOG, connectorLabel } from "@/lib/connectors/catalog";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { exampleIntentFor, installCommand, quickstartSnippet, RUN_COMMAND } from "@/lib/setup/quick-setup";

import { FirstCallWatcher } from "./FirstCallWatcher";
import { SetupAgentForm } from "./SetupAgentForm";

export const metadata: Metadata = { title: "Setup" };

function Step({
  number,
  title,
  done,
  active,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-[14px] border bg-paper-raised p-6 ${active ? "border-line-strong" : "border-line"}`}
      data-testid={`setup-step-${number}`}
      data-done={done}
    >
      <h2 className="flex items-center gap-3 text-[16px] font-semibold text-ink">
        {done ? (
          <Icon name="check_circle" size={22} className="text-allow" />
        ) : (
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-line-strong text-[12px] text-ink-soft">
            {number}
          </span>
        )}
        {title}
      </h2>
      <div className="mt-4 pl-[34px]">{children}</div>
    </section>
  );
}

export default async function SetupPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/setup");
  const db = context.supabase;
  const head = { count: "exact", head: true } as const;
  const canAdmin = ["owner", "admin"].includes(identity.role);

  const [{ data: connections }, agents, calls] = await Promise.all([
    db
      .from("connector_connections")
      .select("id, name, connector_id")
      .eq("owner_kind", "organization")
      .neq("status", "disconnected")
      .order("created_at", { ascending: true }),
    db.from("agents").select("id", head),
    db.from("authorization_decisions").select("id", head),
  ]);

  const connectionRows = connections ?? [];
  const hasConnection = connectionRows.length > 0;
  const hasAgent = (agents.count ?? 0) > 0;
  const hasCall = (calls.count ?? 0) > 0;
  const baseUrl = publicBaseUrl() ?? "";
  const intent = exampleIntentFor(connectionRows.map((c) => c.connector_id));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-lg">
      <PageHeader
        title="Set up Authority"
        description="Three steps. Your agent gets only the access each task needs — nothing more."
      />

      <Step number={1} title="Connect a service" done={hasConnection} active={!hasConnection}>
        {hasConnection ? (
          <ul className="mb-4 flex flex-wrap gap-2">
            {connectionRows.map((c) => (
              <li
                key={c.id}
                className="rounded-full border border-allow/30 bg-allow/10 px-3 py-1 text-[13px] text-ink"
              >
                {connectorLabel(c.connector_id)} · {c.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-[14px] text-ink-soft">
            Pick what your agent should work with. You can add more later.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CONNECTOR_CATALOG.filter((entry) => entry.href).map((entry) => (
            <Link
              key={entry.id}
              href={`${entry.href}?from=setup`}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03]"
              data-testid={`setup-connect-${entry.id}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
              <img src={entry.logo.src} alt="" width={18} height={18} />
              {entry.name}
            </Link>
          ))}
        </div>
      </Step>

      <Step number={2} title="Create your agent" done={hasAgent} active={hasConnection && !hasAgent}>
        {canAdmin ? (
          <SetupAgentForm
            hasAgent={hasAgent}
            connections={connectionRows.map((c) => ({
              id: c.id,
              label: `${connectorLabel(c.connector_id)} · ${c.name}`,
            }))}
          />
        ) : (
          <p className="text-[14px] text-ink-soft">Ask a workspace owner or admin to create the agent.</p>
        )}
      </Step>

      <Step number={3} title="Run your first task" done={hasCall} active={hasAgent && !hasCall}>
        <ol className="flex flex-col gap-4 text-[14px] text-ink-soft">
          <li className="flex flex-col gap-2">
            <span>Install the SDK (Node 20+):</span>
            <CodeBlock code={installCommand(baseUrl)} data-testid="setup-install" />
          </li>
          <li className="flex flex-col gap-2">
            <span>
              Save this as <code>quickstart.mjs</code> next to your <code>.env</code>:
            </span>
            <CodeBlock code={quickstartSnippet(intent)} language="javascript" data-testid="setup-snippet" />
          </li>
          <li className="flex flex-col gap-2">
            <span>Run it:</span>
            <CodeBlock code={RUN_COMMAND} data-testid="setup-run" />
          </li>
        </ol>
        <div className="mt-5">
          {hasCall ? (
            <p className="flex items-center gap-2 text-[14px] text-ink" data-testid="setup-first-call">
              <Icon name="check_circle" size={18} className="text-allow" />
              Your agent made its first call.{" "}
              <Link href="/app/runtime" className="font-medium text-primary hover:underline">
                See it in Activity
              </Link>
            </p>
          ) : hasAgent ? (
            <FirstCallWatcher />
          ) : null}
        </div>
      </Step>

      <p className="text-[13px] text-ink-soft">
        Need more control — approvals per tool, per-customer access, policies?{" "}
        <Link href="/docs/quickstart" className="font-medium text-primary hover:underline">
          Read the guide
        </Link>{" "}
        or open <span className="font-medium text-ink">Advanced</span> in the sidebar.
      </p>
    </div>
  );
}
