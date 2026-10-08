"use client";

import { useState, useTransition } from "react";

import {
  createNotionConnectionAction,
  disconnectNotionConnectionAction,
  setNotionSecretAction,
  verifyNotionConnectionAction,
  type NotionActionResult,
  type NotionCredentialResult,
} from "./actions";
import { DISPLAY_STATUS_LABEL, DISPLAY_STATUS_STYLE, type NotionConnectionRow } from "./status";

const BTN =
  "rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1.5 font-body-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline";

function useAction<T extends NotionActionResult = NotionActionResult>() {
  const [result, setResult] = useState<T | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<T>) =>
    start(async () => {
      setResult(await fn());
    });
  return { result, pending, run };
}

function Result<T extends NotionActionResult>({ result }: { result: T | null }) {
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
  { name: "Retrieve a page", description: "page ID → page properties", kind: "read" },
  { name: "Query a database", description: "database ID → pages in that database", kind: "read" },
  {
    name: "Create a page",
    description: 'database ID, title → new page (title property must be named "Name")',
    kind: "write",
  },
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
  const { result, pending, run } = useAction<NotionCredentialResult>();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");

  return (
    <section
      aria-labelledby="new-notion-connection-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
    >
      <h2
        id="new-notion-connection-heading"
        className="font-headline-sm text-headline-sm font-semibold text-on-surface"
      >
        Connect Notion
      </h2>
      <form
        className="mt-space-sm flex flex-col gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createNotionConnectionAction(name, token));
        }}
      >
        <div className="flex flex-wrap items-end gap-space-sm">
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Notion"
              className={INPUT}
              data-testid="notion-name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
              Internal integration token
            </span>
            <input
              required
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ntn_…"
              className={`${INPUT} w-72`}
              autoComplete="off"
              data-testid="notion-secret-value"
            />
          </label>
          <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="notion-connect">
            Save and verify
          </button>
        </div>
      </form>
      <p className="mt-space-sm font-body-sm text-body-sm text-outline">
        Create an internal integration token at notion.so/my-integrations, then share the specific pages or
        databases agents should reach with that integration via Notion&apos;s own &quot;Connections&quot; menu
        — the token alone cannot see anything you have not shared with it. Only one connection can be active
        at a time; disconnect the current one before connecting a different integration.
      </p>
      <div className="mt-space-sm">
        <SupportedOperations />
      </div>
      <Result result={result} />
    </section>
  );
}

function CredentialForm({ connectionId }: { connectionId: string }) {
  const { result, pending, run } = useAction<NotionCredentialResult>();
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setNotionSecretAction(connectionId, value));
        setValue("");
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
          Internal integration token
        </span>
        <input
          required
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ntn_…"
          className={`${INPUT} w-72`}
          autoComplete="off"
          data-testid="notion-secret-value"
        />
      </label>
      <button type="submit" disabled={pending} className={BTN} data-testid="notion-save-secret">
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
  connection: NotionConnectionRow;
  canAdmin: boolean;
}) {
  const disconnectAction = useAction<NotionActionResult>();
  const verifyAction = useAction<NotionCredentialResult>();
  const pending = disconnectAction.pending || verifyAction.pending;
  const disconnected = connection.displayStatus === "disconnected";

  return (
    <section
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      data-testid={`notion-connection-${connection.id}`}
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
              data-testid={`notion-verify-${connection.id}`}
              onClick={() => verifyAction.run(() => verifyNotionConnectionAction(connection.id))}
            >
              Verify
            </button>
          ) : null}
          {canAdmin && !disconnected ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`notion-disconnect-${connection.id}`}
              onClick={() => disconnectAction.run(() => disconnectNotionConnectionAction(connection.id))}
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
