"use client";

import { useState, useTransition } from "react";

import {
  createLinearConnectionAction,
  disconnectLinearConnectionAction,
  setLinearSecretAction,
  verifyLinearConnectionAction,
  type LinearActionResult,
  type LinearCredentialResult,
} from "./actions";
import { DISPLAY_STATUS_LABEL, DISPLAY_STATUS_STYLE, type LinearConnectionRow } from "./status";

const BTN =
  "rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1.5 font-body-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline";

function useAction<T extends LinearActionResult = LinearActionResult>() {
  const [result, setResult] = useState<T | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<T>) =>
    start(async () => {
      setResult(await fn());
    });
  return { result, pending, run };
}

function Result<T extends LinearActionResult>({ result }: { result: T | null }) {
  if (!result) return null;
  const ok = result.ok && ("verified" in result ? result.verified !== false : true);
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`font-body-sm text-body-sm ${ok ? "text-allow" : result.ok ? "text-secondary" : "text-deny"}`}
    >
      {result.ok ? (result.message ?? "Done.") : result.error}
    </p>
  );
}

const SUPPORTED_OPERATIONS: Array<{ name: string; description: string; kind: "read" | "write" }> = [
  { name: "List issues", description: "team ID → up to 50 issues on that team", kind: "read" },
  { name: "Get issue", description: "issue ID → title, description, state, assignee", kind: "read" },
  { name: "Create issue", description: "team ID, title, description → new issue", kind: "write" },
];

function SupportedOperations() {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
        Supported operations
      </span>
      <ul className="flex flex-col gap-1.5">
        {SUPPORTED_OPERATIONS.map((op) => (
          <li
            key={op.name}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-outline-variant/30 bg-surface-container-low px-2.5 py-1.5"
          >
            <span className="font-body-sm text-body-sm font-medium text-on-surface">{op.name}</span>
            <span className="font-body-sm text-[12px] text-on-surface-variant">{op.description}</span>
            <span
              className={`ml-auto rounded px-1.5 py-0.5 font-mono-code text-[10px] uppercase tracking-wide ${
                op.kind === "write" ? "bg-secondary/10 text-secondary" : "bg-allow/10 text-allow"
              }`}
            >
              {op.kind}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConnectConnectionForm() {
  const { result, pending, run } = useAction<LinearCredentialResult>();
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");

  return (
    <section
      aria-labelledby="new-linear-connection-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
    >
      <h2
        id="new-linear-connection-heading"
        className="font-headline-sm text-headline-sm font-semibold text-on-surface"
      >
        Connect Linear
      </h2>
      <form
        className="mt-space-sm flex flex-col gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createLinearConnectionAction(name, apiKey));
        }}
      >
        <div className="flex flex-wrap items-end gap-space-sm">
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Linear"
              className={INPUT}
              data-testid="linear-name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
              Personal API key
            </span>
            <input
              required
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="lin_api_…"
              className={`${INPUT} w-72`}
              autoComplete="off"
              data-testid="linear-secret-value"
            />
          </label>
          <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="linear-connect">
            Save and verify
          </button>
        </div>
      </form>
      <p className="mt-space-sm font-body-sm text-body-sm text-outline">
        Create a personal API key from Linear&apos;s Settings → Account → API, scoped to only the workspace
        agents should reach. Only one connection can be active at a time; disconnect the current one before
        connecting a different workspace.
      </p>
      <div className="mt-space-sm">
        <SupportedOperations />
      </div>
      <Result result={result} />
    </section>
  );
}

function CredentialForm({ connectionId }: { connectionId: string }) {
  const { result, pending, run } = useAction<LinearCredentialResult>();
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setLinearSecretAction(connectionId, value));
        setValue("");
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
          Personal API key
        </span>
        <input
          required
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="lin_api_…"
          className={`${INPUT} w-72`}
          autoComplete="off"
          data-testid="linear-secret-value"
        />
      </label>
      <button type="submit" disabled={pending} className={BTN} data-testid="linear-save-secret">
        Save and verify
      </button>
      <Result result={result} />
    </form>
  );
}

export function ConnectionCard({
  connection,
  canAdmin,
}: {
  connection: LinearConnectionRow;
  canAdmin: boolean;
}) {
  const disconnectAction = useAction<LinearActionResult>();
  const verifyAction = useAction<LinearCredentialResult>();
  const pending = disconnectAction.pending || verifyAction.pending;
  const disconnected = connection.displayStatus === "disconnected";

  return (
    <section
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      data-testid={`linear-connection-${connection.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">{connection.name}</h2>
        <div className="flex items-center gap-space-sm">
          <span
            className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${DISPLAY_STATUS_STYLE[connection.displayStatus]}`}
          >
            {DISPLAY_STATUS_LABEL[connection.displayStatus]}
          </span>
          {canAdmin && connection.hasSecret && !disconnected ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`linear-verify-${connection.id}`}
              onClick={() => verifyAction.run(() => verifyLinearConnectionAction(connection.id))}
            >
              Verify
            </button>
          ) : null}
          {canAdmin && !disconnected ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`linear-disconnect-${connection.id}`}
              onClick={() => disconnectAction.run(() => disconnectLinearConnectionAction(connection.id))}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>
      <Result result={verifyAction.result} />
      <Result result={disconnectAction.result} />

      {canAdmin && !disconnected ? (
        <div className="mt-space-md flex flex-col gap-space-sm">
          <CredentialForm connectionId={connection.id} />
        </div>
      ) : null}

      <div className="mt-space-md">
        <SupportedOperations />
      </div>
    </section>
  );
}
