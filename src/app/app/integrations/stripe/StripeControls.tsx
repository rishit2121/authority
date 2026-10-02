"use client";

import { useState, useTransition } from "react";

import {
  createStripeConnectionAction,
  disconnectStripeConnectionAction,
  setStripeSecretAction,
  verifyStripeConnectionAction,
  type StripeActionResult,
  type StripeCredentialResult,
  type StripeMode,
} from "./actions";
import { DISPLAY_STATUS_LABEL, DISPLAY_STATUS_STYLE, type StripeConnectionRow } from "./status";

const BTN =
  "rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1.5 font-body-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline";

function useAction<T extends StripeActionResult = StripeActionResult>() {
  const [result, setResult] = useState<T | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<T>) =>
    start(async () => {
      setResult(await fn());
    });
  return { result, pending, run };
}

function Result<T extends StripeActionResult>({ result }: { result: T | null }) {
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

const SUPPORTED_OPERATIONS: Array<{
  name: string;
  description: string;
  kind: "read" | "write";
  approval?: string;
}> = [
  { name: "Retrieve payment", description: "payment ID → payment intent details", kind: "read" },
  { name: "Retrieve customer", description: "customer ID → customer details", kind: "read" },
  { name: "List charges", description: "customer ID → that customer's charges", kind: "read" },
  {
    name: "Create refund",
    description: "payment ID, amount → refund",
    kind: "write",
    approval: "Always requires approval",
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
            {op.approval ? (
              <span className="rounded bg-deny/10 px-1.5 py-0.5 font-mono-code text-[10px] uppercase tracking-wide text-deny">
                {op.approval}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModeSelect({
  mode,
  onChange,
  testId,
}: {
  mode: StripeMode;
  onChange: (mode: StripeMode) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Mode</span>
      <select
        value={mode}
        onChange={(e) => onChange(e.target.value as StripeMode)}
        className={INPUT}
        data-testid={testId}
      >
        <option value="test">Test mode</option>
        <option value="live">Live mode</option>
      </select>
    </label>
  );
}

export function ConnectConnectionForm() {
  const { result, pending, run } = useAction<StripeCredentialResult>();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<StripeMode>("test");
  const [secretKey, setSecretKey] = useState("");

  return (
    <section
      aria-labelledby="new-stripe-connection-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
    >
      <h2
        id="new-stripe-connection-heading"
        className="font-headline-sm text-headline-sm font-semibold text-on-surface"
      >
        Connect Stripe
      </h2>
      <form
        className="mt-space-sm flex flex-col gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createStripeConnectionAction(name, mode, secretKey));
        }}
      >
        <div className="flex flex-wrap items-end gap-space-sm">
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Stripe"
              className={INPUT}
              data-testid="stripe-name"
            />
          </label>
          <ModeSelect mode={mode} onChange={setMode} testId="stripe-mode" />
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
              {mode === "test" ? "Restricted test key" : "Restricted live key"}
            </span>
            <input
              required
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={mode === "test" ? "sk_test_…" : "sk_live_…"}
              className={`${INPUT} w-72`}
              autoComplete="off"
              data-testid="stripe-secret-value"
            />
          </label>
          <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="stripe-connect">
            Save and verify
          </button>
        </div>
      </form>
      <p className="mt-space-sm font-body-sm text-body-sm text-outline">
        Use a{" "}
        <a
          href="https://docs.stripe.com/keys#limit-access"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          restricted key
        </a>{" "}
        scoped to only the operations below, not your account&apos;s full secret key. Only one connection can
        be active at a time; disconnect the current one before connecting a different account.
      </p>
      <div className="mt-space-sm">
        <SupportedOperations />
      </div>
      <Result result={result} />
    </section>
  );
}

function CredentialForm({
  connectionId,
  initialMode,
}: {
  connectionId: string;
  initialMode: "test" | "live" | null;
}) {
  const { result, pending, run } = useAction<StripeCredentialResult>();
  const [mode, setMode] = useState<StripeMode>(initialMode ?? "test");
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setStripeSecretAction(connectionId, mode, value));
        setValue("");
      }}
    >
      <ModeSelect mode={mode} onChange={setMode} testId={`stripe-mode-${connectionId}`} />
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
          Restricted key
        </span>
        <input
          required
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === "test" ? "sk_test_…" : "sk_live_…"}
          className={`${INPUT} w-72`}
          autoComplete="off"
          data-testid="stripe-secret-value"
        />
      </label>
      <button type="submit" disabled={pending} className={BTN} data-testid="stripe-save-secret">
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
  connection: StripeConnectionRow;
  canAdmin: boolean;
}) {
  const disconnectAction = useAction<StripeActionResult>();
  const verifyAction = useAction<StripeCredentialResult>();
  const pending = disconnectAction.pending || verifyAction.pending;
  const disconnected = connection.displayStatus === "disconnected";

  return (
    <section
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      data-testid={`stripe-connection-${connection.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">{connection.name}</h2>
        <div className="flex items-center gap-space-sm">
          {connection.connectedAccount ? (
            <span className="rounded border border-outline-variant/30 px-2 py-0.5 font-mono-code text-[11px] text-outline">
              {connection.connectedAccount}
            </span>
          ) : null}
          {connection.mode ? (
            <span className="rounded border border-outline-variant/30 px-2 py-0.5 font-mono-code text-[11px] text-outline">
              {connection.mode === "test" ? "Test mode" : "Live mode"}
            </span>
          ) : null}
          <span
            className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${DISPLAY_STATUS_STYLE[connection.displayStatus]}`}
          >
            {DISPLAY_STATUS_LABEL[connection.displayStatus]}
          </span>
          {canAdmin && connection.hasSecret && !disconnected ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`stripe-verify-${connection.id}`}
              onClick={() => verifyAction.run(() => verifyStripeConnectionAction(connection.id))}
            >
              Verify
            </button>
          ) : null}
          {canAdmin && !disconnected ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`stripe-disconnect-${connection.id}`}
              onClick={() => disconnectAction.run(() => disconnectStripeConnectionAction(connection.id))}
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
          <CredentialForm connectionId={connection.id} initialMode={connection.mode} />
        </div>
      ) : null}

      <div className="mt-space-md">
        <SupportedOperations />
      </div>
    </section>
  );
}
