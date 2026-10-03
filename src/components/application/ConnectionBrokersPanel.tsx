"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createConnectionBrokerAction,
  revokeConnectionBrokerAction,
} from "@/app/app/settings/applications/actions";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface ConnectionBrokerRow {
  id: string;
  url: string;
  status: "active" | "revoked";
  createdAt: string;
}

/**
 * A freshly registered broker's shared secret -- shown exactly once. The
 * application's own broker endpoint needs this same value to verify
 * Authority's signed requests; Authority stores only a Vault reference,
 * never this plaintext again.
 */
function NewBrokerSecretModal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useFocusTrap({ active: true, containerRef, returnFocusRef: containerRef, onClose: onDone });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Broker shared secret"
        className="relative flex w-full max-w-md flex-col gap-4 rounded-[10px] border border-line bg-paper-raised p-6 shadow-[0_8px_28px_rgba(18,20,16,0.12)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[17px] font-semibold text-ink">Broker registered</h2>
          <p className="text-[13px] text-ink-soft">
            Configure your broker endpoint to verify requests signed with this shared secret — it will never
            be shown again.
          </p>
        </div>
        <code className="break-all rounded-lg border border-line bg-paper px-3 py-2.5 font-mono-code text-[12px] text-ink">
          {secret}
        </code>
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(secret);
              setCopied(true);
            }}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-strong px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03]"
          >
            <Icon name="verified_user" size={14} />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-fixed"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConnectionBrokersPanel({
  applicationId,
  brokers,
}: {
  applicationId: string;
  brokers: ConnectionBrokerRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createConnectionBrokerAction(applicationId, url.trim(), secretInput);
      if (result.ok && result.data) {
        setFreshSecret(secretInput);
        setUrl("");
        setSecretInput("");
        router.refresh();
      } else {
        setError(result.error ?? "Could not register the broker.");
      }
    });
  }

  function handleRevoke(brokerId: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeConnectionBrokerAction(applicationId, brokerId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not revoke the broker.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-paper-raised p-5">
      <h2 className="text-[15px] font-semibold text-ink">Connection brokers (bring-your-own-connection)</h2>
      <p className="text-[13px] text-ink-soft">
        For an application that already manages its own provider OAuth client and token storage. Authority
        asks your registered endpoint for a short-lived access token at execution time, uses it once in
        memory, and discards it — no provider refresh token is ever stored here.
      </p>

      {error ? (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      ) : null}
      {freshSecret ? <NewBrokerSecretModal secret={freshSecret} onDone={() => setFreshSecret(null)} /> : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
            Broker URL
          </span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.acme.com/authority/broker"
            className="w-72 rounded-lg border border-line-strong bg-paper px-2.5 py-1.5 text-[13px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
            Shared secret (you choose; 32–512 characters)
          </span>
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            className="w-72 rounded-lg border border-line-strong bg-paper px-2.5 py-1.5 font-mono-code text-[12px] text-ink"
          />
        </label>
        <button
          type="button"
          disabled={pending || !url || secretInput.length < 32}
          onClick={handleCreate}
          className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:opacity-50"
        >
          Register
        </button>
      </div>

      {brokers.length === 0 ? (
        <p className="text-[13px] text-ink-soft">No brokers registered yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {brokers.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper p-3.5"
            >
              <span className="font-mono-code text-[12px] text-ink">{b.url}</span>
              <div className="flex items-center gap-2">
                <StatusPill tone={b.status === "active" ? "positive" : "negative"}>
                  {b.status === "active" ? "Active" : "Revoked"}
                </StatusPill>
                {b.status === "active" ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleRevoke(b.id)}
                    className="text-[12px] font-medium text-deny underline disabled:opacity-50"
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
