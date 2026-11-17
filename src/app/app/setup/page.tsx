import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/PageHeader";
import { CONNECTOR_CATALOG } from "@/lib/connectors/catalog";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { loadGithubOverview } from "@/lib/github/read-model";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { INIT_COMMAND } from "@/lib/proof-run/commands";
import { setupHref } from "@/lib/setup/return-to";
import {
  CONNECTION_STATE_LABEL,
  CONNECTOR_IDENTITY,
  connectionSetupState,
  connectionUsableBySetupCustomer,
  describeAccess,
  readCallFor,
  recordedCallLabel,
  SETUP_TASK_KEY_PREFIX,
  setupCustomerExternalId,
  verificationLabel,
  type AccessFacts,
  type AccessScope,
  type CallTone,
  type ConnectionSetupState,
} from "@/lib/setup/state";

import { CallAndCode, type RecordedCall } from "./CallAndCode";
import {
  AccessControls,
  AppPicker,
  ConnectionPicker,
  CreateAppForm,
  NewAppToggle,
  type PickerCard,
} from "./SetupControls";
import { SetupSample } from "./SetupSample";
import { Pill, Step } from "./Step";

export const metadata: Metadata = { title: "Setup" };

/**
 * The guided Setup page: 1 Connect a service -> 2 Make a protected call -> 3 Use it in your code.
 *
 * Progress lives in the query string (`?app=<id>&connection=<id>&task=<id>`) so a consent redirect or a refresh comes
 * back to the same step. Every id in it is re-validated here against the caller's tenant through RLS (a foreign or
 * stale id simply matches no row and is ignored); nothing in the URL is trusted, and no key is ever put in it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATE_TONE: Record<ConnectionSetupState, CallTone> = {
  not_connected: "neutral",
  needs_consent: "attention",
  ready: "positive",
  needs_access: "attention",
  needs_reconnect: "negative",
};

const CONNECT_LABEL: Record<string, string> = {
  gmail: "Connect a Google account",
  slack: "Add a Slack bot token",
  github: "Install the GitHub App",
};

/** Which connection rows belong to which catalog card. */
function cardMatches(cardId: string, connectorId: string): boolean {
  if (cardId === "postgresql") return connectorId.startsWith("postgres_");
  if (cardId === "custom-api") return connectorId.startsWith("custom_");
  return connectorId === cardId;
}

function connectorName(connectorId: string): string {
  return CONNECTOR_CATALOG.find((entry) => cardMatches(entry.id, connectorId))?.name ?? connectorId;
}

const CONNECT_RESULT_LABEL: Record<string, string> = {
  gmail: "Gmail",
  github: "GitHub",
};

function EntryChoice({ mode, appId }: { mode: "sample" | "live"; appId: string | null }) {
  const base =
    "flex flex-1 flex-col gap-1 rounded-[12px] border px-4 py-3 text-left transition-colors hover:bg-black/[0.02]";
  return (
    <nav aria-label="How do you want to start?" className="flex flex-col gap-2 sm:flex-row">
      <Link
        href="/app/setup?mode=sample"
        aria-current={mode === "sample" ? "page" : undefined}
        className={`${base} ${mode === "sample" ? "border-line-strong bg-paper-raised" : "border-line"}`}
        data-testid="setup-entry-sample"
      >
        <span className="text-[14px] font-semibold text-ink">Try with sample data</span>
        <span className="text-[13px] text-ink-soft">
          A recorded run. No accounts connected, nothing live.
        </span>
      </Link>
      <Link
        href={setupHref({ app: appId })}
        aria-current={mode === "live" ? "page" : undefined}
        className={`${base} ${mode === "live" ? "border-line-strong bg-paper-raised" : "border-line"}`}
        data-testid="setup-entry-live"
      >
        <span className="text-[14px] font-semibold text-ink">Connect a service</span>
        <span className="text-[13px] text-ink-soft">Your own account, one real protected call.</span>
      </Link>
    </nav>
  );
}

function one(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const mode = one(params, "mode") === "sample" ? "sample" : "live";
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/setup");
  const db = context.supabase;
  const canAdmin = ["owner", "admin"].includes(identity.role);

  const header = (
    <PageHeader
      title="Set up Authority"
      description="Connect one service, make one real protected call, then copy the code. Your agent gets only the access each task needs."
    />
  );

  // The sample path never touches the database's connections, and never turns into a live result on its own.
  if (mode === "sample") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-lg">
        {header}
        <EntryChoice mode="sample" appId={null} />
        <SetupSample label="Sample · no accounts connected" />
        <p className="text-[13px] text-ink-soft">
          Ready for your own account?{" "}
          <Link href="/app/setup" className="font-medium text-primary hover:underline">
            Connect a service
          </Link>
          .
        </p>
      </div>
    );
  }

  // ---- App ------------------------------------------------------------------------------------------------------
  const { data: appRows } = await db
    .from("applications")
    .select("id, name")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  const apps = appRows ?? [];
  const requestedAppId = one(params, "app");
  const requestedApp =
    requestedAppId && UUID.test(requestedAppId) ? apps.find((a) => a.id === requestedAppId) : null;
  // Exactly one app: preselected. Several: the user must choose; never the oldest by default.
  const app = requestedApp ?? (apps.length === 1 ? apps[0]! : null);

  const connected = one(params, "connected");
  const connectError = one(params, "connect_error");
  const banner = connectError ? (
    <p role="alert" className="rounded-lg border border-deny/40 bg-deny/10 px-3 py-2 text-[13px] text-deny">
      Connecting did not finish ({connectError.slice(0, 60)}). Try again from the card below.
    </p>
  ) : connected && CONNECT_RESULT_LABEL[connected] ? (
    <p role="status" className="rounded-lg border border-allow/30 bg-allow/10 px-3 py-2 text-[13px] text-ink">
      {CONNECT_RESULT_LABEL[connected]} connected. Choose the connection below and confirm it.
    </p>
  ) : null;

  const appSection = (
    <div className="flex flex-col gap-3" data-testid="setup-app">
      <h3 className="text-[14px] font-semibold text-ink">Your app</h3>
      {apps.length === 0 ? (
        canAdmin ? (
          <>
            <p className="text-[13px] text-ink-soft">
              An app is your product: its customers are the people your agent acts for. Create one to start.
            </p>
            <CreateAppForm />
          </>
        ) : (
          <p className="text-[13px] text-ink-soft">Ask a workspace owner or admin to create your app.</p>
        )
      ) : (
        <>
          {apps.length === 1 && app ? (
            <p className="text-[14px] text-ink" data-testid="setup-app-name-display">
              {app.name}
            </p>
          ) : (
            <AppPicker apps={apps} selectedId={app?.id ?? null} />
          )}
          {canAdmin ? <NewAppToggle /> : null}
        </>
      )}
    </div>
  );

  if (!app) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-lg">
        {header}
        <EntryChoice mode="live" appId={null} />
        {banner}
        <Step number={1} title="Connect a service" done={false} active>
          {appSection}
        </Step>
      </div>
    );
  }

  // ---- Connections -----------------------------------------------------------------------------------------------
  const setupExternalId = setupCustomerExternalId(identity.userId);
  const [{ data: connectionRows }, { data: setupCustomer }, { data: policyRows }, { installation }] =
    await Promise.all([
      db
        .from("connector_connections")
        .select(
          "id, name, connector_id, status, health_reasons, last_verified_at, owner_kind, owner_customer_id",
        )
        .eq("owner_kind", "organization")
        .neq("status", "disconnected")
        .is("archived_at", null)
        .order("created_at", { ascending: true }),
      db
        .from("customers")
        .select("id")
        .eq("application_id", app.id)
        .eq("external_id", setupExternalId)
        .maybeSingle(),
      db
        .from("application_connection_access_policies")
        .select("connection_id, scope")
        .eq("application_id", app.id),
      loadGithubOverview(db),
    ]);
  const connections = connectionRows ?? [];
  const connectionIds = connections.map((c) => c.id);
  const setupCustomerId = setupCustomer?.id ?? null;

  const [{ data: secretRows }, { data: delegationRows }] = await Promise.all([
    connectionIds.length
      ? db.from("connector_connection_secrets").select("connection_id").in("connection_id", connectionIds)
      : Promise.resolve({ data: [] as Array<{ connection_id: string }> }),
    connectionIds.length
      ? db
          .from("connection_delegations")
          .select("connection_id, customer_id")
          .in("connection_id", connectionIds)
          .is("revoked_at", null)
      : Promise.resolve({ data: [] as Array<{ connection_id: string; customer_id: string }> }),
  ]);
  // Only delegations to customers of THIS app count toward "who can use it" for this app.
  const delegatedIds = [...new Set((delegationRows ?? []).map((d) => d.customer_id))];
  const { data: appCustomerRows } = delegatedIds.length
    ? await db.from("customers").select("id").eq("application_id", app.id).in("id", delegatedIds)
    : { data: [] as Array<{ id: string }> };
  const appCustomerIds = new Set((appCustomerRows ?? []).map((c) => c.id));
  const withCredential = new Set((secretRows ?? []).map((s) => s.connection_id));
  const scopeByConnection = new Map((policyRows ?? []).map((p) => [p.connection_id, p.scope as AccessScope]));

  const accessFactsFor = (c: (typeof connections)[number]): AccessFacts => ({
    ownerKind: c.owner_kind,
    ownerCustomerId: c.owner_customer_id,
    scope: scopeByConnection.get(c.id) ?? null,
    delegatedCustomerIds: (delegationRows ?? [])
      .filter((d) => d.connection_id === c.id && appCustomerIds.has(d.customer_id))
      .map((d) => d.customer_id),
  });
  const stateFor = (c: (typeof connections)[number]) =>
    connectionSetupState({
      status: c.status,
      healthReasons: c.health_reasons,
      hasCredential: withCredential.has(c.id),
      usableBySetupCustomer: connectionUsableBySetupCustomer(accessFactsFor(c), setupCustomerId),
    });

  const returnTo = setupHref({ app: app.id });
  const cards: PickerCard[] = CONNECTOR_CATALOG.filter((entry) => entry.href).map((entry) => {
    const rows = connections.filter((c) => cardMatches(entry.id, c.connector_id));
    const isGithub = entry.id === "github";
    return {
      connectorId: entry.id,
      name: entry.name,
      logo: entry.logo.src,
      identity: CONNECTOR_IDENTITY[entry.id] ?? entry.description,
      connectHref: `${entry.href}?returnTo=${encodeURIComponent(returnTo)}`,
      connectLabel:
        rows.length > 0 ? "Connect another" : (CONNECT_LABEL[entry.id] ?? `Connect ${entry.name}`),
      note: isGithub
        ? installation
          ? {
              text: `Installed on ${installation.accountLogin} (${installation.status}); access is per repository, not used for the sample call`,
              tone: installation.status === "active" ? "positive" : "attention",
            }
          : { text: "Not connected", tone: "neutral" }
        : null,
      connections: rows.map((c) => {
        const state = stateFor(c);
        return {
          id: c.id,
          name: c.name,
          stateLabel: CONNECTION_STATE_LABEL[state],
          stateTone: STATE_TONE[state],
          verification: verificationLabel(c.last_verified_at),
        };
      }),
    };
  });
  // Services you have already connected first (catalog order otherwise), so your connection is at the top.
  cards.sort((a, b) => Number(b.connections.length > 0) - Number(a.connections.length > 0));

  const requestedConnectionId = one(params, "connection");
  const chosen =
    requestedConnectionId && UUID.test(requestedConnectionId)
      ? (connections.find((c) => c.id === requestedConnectionId) ?? null)
      : null;
  const chosenState = chosen ? stateFor(chosen) : null;
  const chosenFacts = chosen ? accessFactsFor(chosen) : null;

  // ---- A setup task from the URL, rebuilt from the database ----------------------------------------------------
  let recorded: RecordedCall | null = null;
  const requestedTaskId = one(params, "task");
  if (chosen && requestedTaskId && UUID.test(requestedTaskId)) {
    const { data: task } = await db
      .from("tasks")
      .select("id, created_at, customer_id, idempotency_key")
      .eq("id", requestedTaskId)
      .maybeSingle();
    const { data: taskCustomer } = task?.customer_id
      ? await db.from("customers").select("application_id").eq("id", task.customer_id).maybeSingle()
      : { data: null };
    if (
      task &&
      task.idempotency_key?.startsWith(SETUP_TASK_KEY_PREFIX) &&
      taskCustomer?.application_id === app.id
    ) {
      const [{ data: decisions }, { data: receipts }] = await Promise.all([
        db
          .from("authorization_decisions")
          .select("outcome, reason_codes, created_at")
          .eq("task_id", task.id)
          .order("created_at", { ascending: false })
          .limit(1),
        db
          .from("connector_execution_receipts")
          .select("id, result_category, created_at")
          .eq("task_id", task.id)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      const decision = decisions?.[0] ?? null;
      const receipt = receipts?.[0] ?? null;
      recorded = {
        taskId: task.id,
        createdAt: task.created_at,
        label: recordedCallLabel({
          decisionOutcome: decision?.outcome ?? null,
          receiptResult: receipt?.result_category ?? null,
        }),
        reasonCodes: Array.isArray(decision?.reason_codes)
          ? (decision.reason_codes as unknown[]).filter((c): c is string => typeof c === "string")
          : [],
        receiptId: receipt?.id ?? null,
      };
    }
  }

  const baseUrl = publicBaseUrl() ?? "";
  const access = chosen && chosenFacts ? describeAccess(chosenFacts, app.name) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-lg">
      {header}
      <EntryChoice mode="live" appId={app.id} />
      {banner}

      <Step
        number={1}
        title="Connect a service"
        done={chosenState === "ready"}
        active={chosenState !== "ready"}
      >
        {appSection}
        <div className="flex flex-col gap-3">
          <h3 className="text-[14px] font-semibold text-ink">Your connection</h3>
          <ConnectionPicker
            key={app.id}
            applicationId={app.id}
            cards={cards}
            confirmedId={chosen?.id ?? null}
            canAdmin={canAdmin}
          />
        </div>

        {chosen && chosenFacts && access && chosenState ? (
          <div
            className="flex flex-col gap-3 rounded-[10px] border border-line p-4"
            data-testid="setup-access"
          >
            <h3 className="text-[14px] font-semibold text-ink">Who can use this connection</h3>
            <p className="text-[13px] text-ink-soft">
              {connectorName(chosen.connector_id)} · {chosen.name}, for {app.name}:
            </p>
            <p className="text-[14px] text-ink" data-testid="setup-access-summary">
              {access.text}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
              Your test customer:{" "}
              <Pill tone={STATE_TONE[chosenState]} testId="setup-chosen-state">
                {CONNECTION_STATE_LABEL[chosenState]}
              </Pill>
              {verificationLabel(chosen.last_verified_at)}
            </p>
            {chosenState === "needs_consent" ? (
              <p className="text-[13px] text-ink-soft">
                This connection has no credential yet. Finish connecting it from its card above.
              </p>
            ) : chosenState === "needs_reconnect" ? (
              <p className="text-[13px] text-ink-soft">
                This connection stopped working. Reconnect it from its card above.
              </p>
            ) : (
              <AccessControls
                applicationId={app.id}
                connectionId={chosen.id}
                appName={app.name}
                canAdmin={canAdmin}
                setupCustomerHasAccess={chosenState === "ready"}
                sharedWithEveryone={chosenFacts.scope === "application_shared"}
                organizationOwned={chosen.owner_kind === "organization"}
              />
            )}
          </div>
        ) : null}
      </Step>

      {chosen ? (
        <CallAndCode
          key={chosen.id}
          applicationId={app.id}
          connectionId={chosen.id}
          connectorId={chosen.connector_id}
          call={readCallFor(chosen.connector_id)}
          canAdmin={canAdmin}
          ready={chosenState === "ready"}
          baseUrl={baseUrl}
          initCommand={INIT_COMMAND}
          testUserId={setupExternalId}
          recorded={recorded}
          today={new Date().toISOString().slice(0, 10)}
        />
      ) : (
        <>
          <Step number={2} title="Make a protected call" done={false} active={false}>
            <p className="text-[14px] text-ink-soft">Choose a connection in step 1 first.</p>
          </Step>
          <Step number={3} title="Use it in your code" done={false} active={false}>
            <p className="text-[14px] text-ink-soft">The code for your connection appears here.</p>
          </Step>
        </>
      )}

      <p className="text-[13px] text-ink-soft">
        Need more control: approvals per tool, per-customer access, policies?{" "}
        <Link href="/docs/quickstart" className="font-medium text-primary hover:underline">
          Read the guide
        </Link>{" "}
        or open{" "}
        <Link
          href={`/app/settings/applications/${app.id}/get-started`}
          className="font-medium text-primary hover:underline"
        >
          this app&apos;s access settings
        </Link>
        .
      </p>
    </div>
  );
}
