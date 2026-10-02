"use client";

import { useState, useTransition } from "react";

import {
  createStripeConnectionAction,
  disconnectStripeConnectionAction,
  setStripeSecretAction,
  type StripeActionResult,
} from "./actions";
import type { StripeConnectionRow } from "./page";

const BTN =
  "rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1.5 font-body-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline";

function useAction() {
  const [result, setResult] = useState<StripeActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<StripeActionResult>) =>
    start(async () => {
      setResult(await fn());
    });
  return { result, pending, run };
}

function Result({ result }: { result: StripeActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`font-body-sm text-body-sm ${result.ok ? "text-allow" : "text-deny"}`}
    >
      {result.ok ? (result.message ?? "Done.") : result.error}
    </p>
  );
}

const ENVIRONMENTS = ["development", "staging", "production"] as const;

export function ConnectConnectionForm() {
  const { result, pending, run } = useAction();
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<(typeof ENVIRONMENTS)[number]>("development");

  return (
    <section
      aria-labelledby="new-stripe-connection-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
    >
      <h2
        id="new-stripe-connection-heading"
        className="font-headline-sm text-headline-sm font-semibold text-on-surface"
      >
        New connection
      </h2>
      <form
        className="mt-space-sm flex flex-wrap items-end gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createStripeConnectionAction(name, environment));
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stripe (test mode)"
            className={INPUT}
            data-testid="stripe-name"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
            Environment
          </span>
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as (typeof ENVIRONMENTS)[number])}
            className={INPUT}
            data-testid="stripe-environment"
          >
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="stripe-connect">
          Connect
        </button>
      </form>
      <p className="mt-space-sm font-body-sm text-body-sm text-outline">
        Keep at most one connection active at a time. A task binds to whichever connection is active the first
        time it calls a Stripe tool, for its whole lifetime — disconnect the old one before connecting a new
        key, rather than running two active connections side by side.
      </p>
      <Result result={result} />
    </section>
  );
}

function SecretForm({ connectionId }: { connectionId: string }) {
  const { result, pending, run } = useAction();
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setStripeSecretAction(connectionId, value));
        setValue("");
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Secret key</span>
        <input
          required
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk_test_…"
          className={`${INPUT} w-72`}
          autoComplete="off"
          data-testid="stripe-secret-value"
        />
      </label>
      <button type="submit" disabled={pending} className={BTN} data-testid="stripe-save-secret">
        Save secret key
      </button>
      <Result result={result} />
    </form>
  );
}

export function ConnectionCard({
  connection,
  statusStyle,
  canAdmin,
}: {
  connection: StripeConnectionRow;
  statusStyle: string;
  canAdmin: boolean;
}) {
  const { result, pending, run } = useAction();
  return (
    <section
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      data-testid={`stripe-connection-${connection.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">{connection.name}</h2>
        <div className="flex items-center gap-space-sm">
          <span className="rounded border border-outline-variant/30 px-2 py-0.5 font-mono-code text-[11px] text-outline">
            {connection.environment}
          </span>
          <span className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${statusStyle}`}>
            {connection.status}
          </span>
          {canAdmin && connection.status !== "disconnected" ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`stripe-disconnect-${connection.id}`}
              onClick={() => run(() => disconnectStripeConnectionAction(connection.id))}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>
      <Result result={result} />

      {canAdmin && connection.status !== "disconnected" ? (
        <div className="mt-space-md flex flex-col gap-space-sm">
          <SecretForm connectionId={connection.id} />
        </div>
      ) : null}
    </section>
  );
}
