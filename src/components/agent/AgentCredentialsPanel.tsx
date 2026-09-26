"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createAgentCredentialAction, revokeAgentCredentialAction } from "@/app/app/agents/[agentId]/actions";
import { Icon } from "@/components/ui/Icon";

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
 * Issuing and revoking an agent's runtime credentials.
 *
 * A freshly issued secret is shown exactly once, in the banner below,
 * immediately after `createAgentCredentialAction` returns it — it is never
 * fetched again afterward, by this component or anything else, because the
 * database never stores it (only its SHA-256 hash).
 */
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
  const [freshSecret, setFreshSecret] = useState<{ keyPrefix: string; plaintextSecret: string } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createAgentCredentialAction(agentId);
      if (result.ok && result.data) {
        setFreshSecret({ keyPrefix: result.data.keyPrefix, plaintextSecret: result.data.plaintextSecret });
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
    <div className="flex flex-col gap-space-md rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg">
      <div className="flex items-center justify-between">
        <h2 className="font-headline-sm text-[1.1rem] font-semibold text-on-surface">Runtime credentials</h2>
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-surface-container-high px-3 py-1.5 font-label-md text-label-md text-on-surface hover:bg-surface-container-highest disabled:opacity-50"
        >
          <Icon name="key" size={16} />
          Issue credential
        </button>
      </div>

      <p className="font-body-sm text-body-sm text-on-surface-variant">
        A runtime credential lets this agent call <code>POST /api/v1/authorize</code> with no Supabase session
        — only a SHA-256 hash of the secret is ever stored. The plaintext is shown once, below, immediately
        after issuing it.
      </p>

      {error && <p className="font-body-sm text-body-sm text-deny">{error}</p>}

      {freshSecret && (
        <div className="flex flex-col gap-2 rounded-lg border border-allow/40 bg-allow/10 p-space-md">
          <p className="font-label-md text-label-md text-allow">
            New credential issued — copy it now, it will never be shown again.
          </p>
          <code className="break-all rounded bg-surface p-2 font-mono-code text-[12px] text-on-surface">
            {freshSecret.plaintextSecret}
          </code>
          <button
            type="button"
            onClick={() => setFreshSecret(null)}
            className="self-end font-label-sm text-label-sm text-on-surface-variant underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {credentials.length === 0 ? (
        <p className="font-body-sm text-body-sm text-outline">No runtime credentials have been issued yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {credentials.map((credential) => (
            <li
              key={credential.id}
              className="flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-surface p-space-md"
            >
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono-code text-[12px] text-on-surface">{credential.keyPrefix}…</code>
                <span
                  className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] ${
                    credential.status === "active"
                      ? "border-allow/30 bg-allow/10 text-allow"
                      : "border-deny/40 bg-deny/10 text-deny"
                  }`}
                >
                  {credential.status}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Issued {new Date(credential.createdAt).toLocaleString()}
                {credential.lastUsedAt && ` · last used ${new Date(credential.lastUsedAt).toLocaleString()}`}
              </p>
              {credential.status === "revoked" && credential.revocationReason && (
                <p className="font-body-sm text-body-sm text-outline">
                  Revoked: {credential.revocationReason}
                </p>
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
                        className="rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleRevoke(credential.id)}
                          disabled={pending}
                          className="rounded border border-deny/40 bg-deny/10 px-2 py-1 font-label-sm text-label-sm text-deny disabled:opacity-50"
                        >
                          Confirm revoke
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRevokingId(null);
                            setReason("");
                          }}
                          className="rounded border border-outline-variant/40 px-2 py-1 font-label-sm text-label-sm text-on-surface-variant"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRevokingId(credential.id)}
                      className="self-start font-label-sm text-label-sm text-deny underline"
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
