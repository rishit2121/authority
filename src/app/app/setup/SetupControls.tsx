"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createSetupApplicationAction,
  shareWithEveryCustomerAction,
  shareWithTestCustomerAction,
} from "./actions";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, Pill } from "./Step";
import { setupHref } from "@/lib/setup/return-to";
import type { CallTone } from "@/lib/setup/state";

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] text-deny">
      {error}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------------------------

export function CreateAppForm({
  initialName = "My app",
  submitLabel = "Create your app",
}: {
  initialName?: string;
  submitLabel?: string;
} = {}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await createSetupApplicationAction({ name });
          if (result.ok && result.data) router.push(setupHref({ app: result.data.applicationId }));
          else setError(result.error ?? "Could not create your app.");
        });
      }}
      data-testid="setup-create-app"
    >
      <label className="flex min-w-[220px] flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">App name</span>
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
          data-testid="setup-app-name"
        />
      </label>
      <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="setup-create-app-submit">
        {pending ? "Creating…" : submitLabel}
      </button>
      <div className="w-full">
        <ErrorText error={error} />
      </div>
    </form>
  );
}

/** For a workspace that already has apps: a new one is one click away instead of only the existing ones. */
export function NewAppToggle() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-[13px] font-medium text-ink underline underline-offset-2 hover:text-ink-soft"
        data-testid="setup-new-app"
      >
        + Create a new app
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-4" data-testid="setup-new-app-form">
      <p className="text-[13px] text-ink-soft">
        An app is your product: its customers are the people your agent acts for.
      </p>
      <CreateAppForm initialName="" submitLabel="Create app" />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-fit text-[13px] text-ink-soft underline underline-offset-2"
      >
        Cancel
      </button>
    </div>
  );
}

export function AppPicker({
  apps,
  selectedId,
}: {
  apps: Array<{ id: string; name: string }>;
  selectedId: string | null;
}) {
  const router = useRouter();
  return (
    <label className="flex max-w-sm flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink">Which app is this for?</span>
      <select
        required
        value={selectedId ?? ""}
        onChange={(e) => {
          if (e.target.value) router.push(setupHref({ app: e.target.value }));
        }}
        className={INPUT}
        data-testid="setup-app-select"
      >
        <option value="" disabled>
          Choose an app…
        </option>
        {apps.map((app) => (
          <option key={app.id} value={app.id}>
            {app.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------------------------------------------

export interface PickerConnection {
  id: string;
  name: string;
  stateLabel: string;
  stateTone: CallTone;
  verification: string;
}

export interface PickerCard {
  connectorId: string;
  name: string;
  logo: string;
  identity: string;
  /** The connector page, with a validated `returnTo` back to this step. Null when there is none. */
  connectHref: string | null;
  connectLabel: string;
  connections: PickerConnection[];
  /** A non-selectable status line (GitHub's installation). */
  note?: { text: string; tone: CallTone } | null;
}

export function ConnectionPicker({
  applicationId,
  cards,
  confirmedId,
  canAdmin,
}: {
  applicationId: string;
  cards: PickerCard[];
  confirmedId: string | null;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const candidates = cards.flatMap((card) => card.connections);
  // Nothing is pre-chosen unless there is exactly one candidate -- and even then the user confirms it below.
  const [selected, setSelected] = useState<string | null>(
    confirmedId ?? (candidates.length === 1 ? candidates[0]!.id : null),
  );

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="setup-connection-cards">
        <legend className="mb-2 text-[13px] text-ink-soft">
          Pick exactly one connection for your first protected call.
        </legend>
        {cards.map((card) => (
          <div
            key={card.connectorId}
            className="flex flex-col gap-3 rounded-[10px] border border-line bg-paper p-4"
            data-testid={`setup-card-${card.connectorId}`}
          >
            <div className="flex items-start gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
              <img src={card.logo} alt="" width={20} height={20} className="mt-0.5" />
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-ink">{card.name}</span>
                <span className="text-[12px] text-ink-soft">{card.identity}</span>
              </div>
            </div>
            {card.note ? (
              <p className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
                <Pill tone={card.note.tone}>{card.note.text}</Pill>
              </p>
            ) : null}
            {card.connections.length === 0 && !card.note ? (
              <p className="text-[12px] text-ink-soft">
                <Pill tone="neutral">Not connected</Pill>
              </p>
            ) : null}
            {card.connections.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {card.connections.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 text-[13px] text-ink has-[:checked]:border-primary">
                      <input
                        type="radio"
                        name="setup-connection"
                        value={c.id}
                        checked={selected === c.id}
                        onChange={() => setSelected(c.id)}
                        className="mt-1"
                        data-testid={`setup-connection-${c.id}`}
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
                          <Pill tone={c.stateTone} testId={`setup-connection-state-${c.id}`}>
                            {c.stateLabel}
                          </Pill>
                          {c.verification}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {selected && card.connections.some((c) => c.id === selected) ? (
              // Right under the chosen connection, not below every service card where it scrolls out of view.
              <div className="flex flex-col gap-2" data-testid="setup-use-connection-row">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={selected === confirmedId}
                    className={BTN_PRIMARY}
                    onClick={() => router.push(setupHref({ app: applicationId, connection: selected }))}
                    data-testid="setup-use-connection"
                  >
                    Use this connection
                  </button>
                  {selected === confirmedId ? (
                    <span className="text-[13px] text-ink-soft">This connection is in use below.</span>
                  ) : null}
                </div>
                {selected !== confirmedId ? (
                  <p className="text-[12px] text-ink-soft">
                    &ldquo;Needs access&rdquo; is expected: next you choose who may use it.
                  </p>
                ) : null}
              </div>
            ) : null}
            {card.connectHref && canAdmin ? (
              <Link
                href={card.connectHref}
                className="text-[13px] font-medium text-primary hover:underline"
                data-testid={`setup-connect-${card.connectorId}`}
              >
                {card.connectLabel}
              </Link>
            ) : null}
          </div>
        ))}
      </fieldset>
      {!canAdmin ? (
        <p className="text-[13px] text-ink-soft">Only an owner or admin can connect a new service.</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------------------------

export function AccessControls({
  applicationId,
  connectionId,
  appName,
  canAdmin,
  setupCustomerHasAccess,
  sharedWithEveryone,
  organizationOwned,
}: {
  applicationId: string;
  connectionId: string;
  appName: string;
  canAdmin: boolean;
  setupCustomerHasAccess: boolean;
  sharedWithEveryone: boolean;
  organizationOwned: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        setConfirming(false);
        router.refresh();
      } else setError(result.error ?? "That did not work. Try again.");
    });
  };

  if (!organizationOwned) return null;

  return (
    <div className="flex flex-col gap-3">
      {setupCustomerHasAccess ? (
        <p className="text-[13px] text-ink" data-testid="setup-access-ok">
          Your test customer can use this connection. Nothing needs to change.
        </p>
      ) : canAdmin ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-ink-soft">
            Your test customer needs access before the protected call can run. This shares the connection with
            that one customer only; nobody else gains anything.
          </p>
          <div>
            <button
              type="button"
              disabled={pending}
              className={BTN_PRIMARY}
              onClick={() => run(() => shareWithTestCustomerAction({ applicationId, connectionId }))}
              data-testid="setup-share-test-customer"
            >
              {pending ? "Sharing…" : "Share with my test customer only"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-ink" data-testid="setup-access-ask-admin">
          <Pill tone="attention">Needs access</Pill> Ask an owner or admin to share it with your test
          customer.
        </p>
      )}

      {canAdmin && !sharedWithEveryone ? (
        <details
          className="rounded-lg border border-line px-3 py-2 text-[13px]"
          data-testid="setup-share-all"
        >
          <summary className="cursor-pointer text-ink-soft">
            Optional: share with every customer of {appName}…
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-ink-soft">
              Not needed for setup. Every current and future customer of {appName} could use this connection
              with no per-customer grant. Choose this only for an account every user genuinely shares.
            </p>
            {confirming ? (
              <div
                className="flex flex-wrap items-center gap-2"
                role="alertdialog"
                aria-label="Confirm sharing"
              >
                <span className="text-ink">Share with every customer of {appName}?</span>
                <button
                  type="button"
                  disabled={pending}
                  className={BTN_SECONDARY}
                  onClick={() =>
                    run(() => shareWithEveryCustomerAction({ applicationId, connectionId, confirmed: true }))
                  }
                  data-testid="setup-share-all-confirm"
                >
                  Yes, share with every customer
                </button>
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={() => setConfirming(false)}
                  data-testid="setup-share-all-cancel"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={() => setConfirming(true)}
                  data-testid="setup-share-all-start"
                >
                  Share with every customer of {appName}…
                </button>
              </div>
            )}
          </div>
        </details>
      ) : null}
      <ErrorText error={error} />
    </div>
  );
}
