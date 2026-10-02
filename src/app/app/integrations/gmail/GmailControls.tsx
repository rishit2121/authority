"use client";

import { useState, useTransition } from "react";

import {
  createGmailConnectionAction,
  disconnectGmailConnectionAction,
  type GmailActionResult,
} from "./actions";
import type { GmailConnectionRow } from "./page";

const BTN =
  "rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1.5 font-body-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline";

function useAction() {
  const [result, setResult] = useState<GmailActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<GmailActionResult>) =>
    start(async () => {
      setResult(await fn());
    });
  return { result, pending, run };
}

function Result({ result }: { result: GmailActionResult | null }) {
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
      aria-labelledby="new-gmail-connection-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
    >
      <h2
        id="new-gmail-connection-heading"
        className="font-headline-sm text-headline-sm font-semibold text-on-surface"
      >
        New connection
      </h2>
      <form
        className="mt-space-sm flex flex-wrap items-end gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createGmailConnectionAction(name, environment));
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gmail (support inbox)"
            className={INPUT}
            data-testid="gmail-name"
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
            data-testid="gmail-environment"
          >
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="gmail-connect">
          Create
        </button>
      </form>
      <p className="mt-space-sm font-body-sm text-body-sm text-outline">
        Keep at most one connection active at a time. A task binds to whichever connection is active the first
        time it calls a Gmail tool, for its whole lifetime.
      </p>
      <Result result={result} />
    </section>
  );
}

export function ConnectionCard({
  connection,
  statusStyle,
  canAdmin,
}: {
  connection: GmailConnectionRow;
  statusStyle: string;
  canAdmin: boolean;
}) {
  const { result, pending, run } = useAction();
  return (
    <section
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      data-testid={`gmail-connection-${connection.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">{connection.name}</h2>
        <div className="flex items-center gap-space-sm">
          <span className="rounded border border-outline-variant/30 px-2 py-0.5 font-mono-code text-[11px] text-outline">
            {connection.environment}
          </span>
          <span
            className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${
              connection.oauthConnected
                ? "border-allow/30 bg-allow/10 text-allow"
                : "border-outline-variant/40 bg-surface-container-high text-on-surface-variant"
            }`}
          >
            {connection.oauthConnected
              ? connection.connectedEmail
                ? `Connected as ${connection.connectedEmail}`
                : "Google account connected"
              : "Not connected to Google"}
          </span>
          <span className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${statusStyle}`}>
            {connection.status}
          </span>
          {canAdmin && connection.status !== "disconnected" ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`gmail-disconnect-${connection.id}`}
              onClick={() => run(() => disconnectGmailConnectionAction(connection.id))}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>
      <Result result={result} />

      {canAdmin && connection.status !== "disconnected" && !connection.oauthConnected ? (
        <form
          className="mt-space-md"
          method="POST"
          action="/api/connectors/gmail/connect"
          data-testid={`gmail-connect-oauth-${connection.id}`}
        >
          <input type="hidden" name="connectionId" value={connection.id} />
          <button type="submit" className={BTN_PRIMARY}>
            Connect with Google
          </button>
        </form>
      ) : null}
    </section>
  );
}
