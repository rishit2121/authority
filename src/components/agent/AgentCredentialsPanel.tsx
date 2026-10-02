"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createAgentCredentialAction, revokeAgentCredentialAction } from "@/app/app/agents/[agentId]/actions";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface AgentCredentialRow {
  id: string;
  keyPrefix: string;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
}

/**
 * A freshly issued secret, shown exactly once in a focused modal immediately
 * after `createAgentCredentialAction` returns it — the database never stores
 * it (only its SHA-256 hash), so once this modal closes it is unrecoverable
 * by anyone, including this UI.
 */
function NewCredentialModal({ plaintextSecret, onDone }: { plaintextSecret: string; onDone: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useFocusTrap({
    active: true,
    containerRef,
    returnFocusRef: containerRef,
    onClose: onDone,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="New runtime credential"
        className="relative flex w-full max-w-md flex-col gap-4 rounded-[10px] border border-line bg-paper-raised p-6 shadow-[0_8px_28px_rgba(18,20,16,0.12)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[17px] font-semibold text-ink">Credential issued</h2>
          <p className="text-[13px] text-ink-soft">
            Copy this secret now — it will never be shown again, and Authority does not store it.
          </p>
        </div>

        <code className="break-all rounded-lg border border-line bg-paper px-3 py-2.5 font-mono-code text-[12px] text-ink">
          {plaintextSecret}
        </code>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(plaintextSecret);
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

/** Issuing and revoking an agent's runtime credentials. */
export function AgentCredentialsPanel({
  agentId,
  credentials,
}: {
  agentId: string;
  credentials: AgentCredentialRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createAgentCredentialAction(agentId);
      if (result.ok && result.data) {
        setFreshSecret(result.data.plaintextSecret);
        router.refresh();
      } else {
        setError(result.error ?? "Could not issue a credential.");
      }
    });
  }

  function handleRevoke(credentialId: string) {
    setError(null);
    if (reason.trim().length === 0) {
      setError("A revocation reason is required.");
      return;
    }
    startTransition(async () => {
      const result = await revokeAgentCredentialAction(agentId, credentialId, reason.trim());
      if (result.ok) {
        setRevokingId(null);
        setReason("");
        router.refresh();
      } else {
        setError(result.error ?? "Could not revoke the credential.");
      }
    });
  }

  return (
    <div
      id="credentials"
      className="flex flex-col gap-4 rounded-[10px] border border-line bg-paper-raised p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">Credentials</h2>
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:opacity-50"
        >
          <Icon name="key" size={15} />
          Issue credential
        </button>
      </div>

      <p className="text-[13px] text-ink-soft">
        A runtime credential lets this agent call <code>POST /api/v1/authorize</code> with no Supabase session
        — only a SHA-256 hash of the secret is ever stored.
      </p>

      {error && (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      )}

      {freshSecret ? (
        <NewCredentialModal plaintextSecret={freshSecret} onDone={() => setFreshSecret(null)} />
      ) : null}

      {credentials.length === 0 ? (
        <p className="text-[13px] text-ink-soft">No runtime credentials have been issued yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {credentials.map((credential) => (
            <li
              key={credential.id}
              className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono-code text-[12px] text-ink">{credential.keyPrefix}…</code>
                <StatusPill tone={credential.status === "active" ? "positive" : "negative"}>
                  {credential.status === "active" ? "Active" : "Revoked"}
                </StatusPill>
              </div>
              <p className="text-[12px] text-ink-soft">
                Issued {new Date(credential.createdAt).toLocaleString()}
                {credential.lastUsedAt && ` · last used ${new Date(credential.lastUsedAt).toLocaleString()}`}
              </p>
              {credential.status === "revoked" && credential.revocationReason && (
                <p className="text-[12px] text-ink-soft">Revoked: {credential.revocationReason}</p>
              )}

              {credential.status === "active" && (
                <>
                  {revokingId === credential.id ? (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Revocation reason"
                        className="rounded-lg border border-line-strong bg-paper px-2.5 py-1.5 text-[13px] text-ink"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleRevoke(credential.id)}
                          disabled={pending}
                          className="rounded-lg border border-deny/40 bg-deny/10 px-2.5 py-1 text-[12px] font-medium text-deny disabled:opacity-50"
                        >
                          Confirm revoke
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRevokingId(null);
                            setReason("");
                          }}
                          className="rounded-lg border border-line-strong px-2.5 py-1 text-[12px] text-ink-soft"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRevokingId(credential.id)}
                      className="self-start text-[12px] font-medium text-deny underline"
                    >
                      Revoke
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
