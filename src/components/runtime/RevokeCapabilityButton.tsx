"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { revokeCapabilityAction } from "@/app/app/runtime/actions";

export function RevokeCapabilityButton({ capabilityId }: { capabilityId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-label-sm text-label-sm text-deny underline"
      >
        Revoke capability
      </button>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
        aria-label="Revocation reason"
        className="rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm"
      />
      <span className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await revokeCapabilityAction(capabilityId, reason);
              if (result.ok) router.refresh();
              else setError(result.error ?? "Could not revoke.");
            })
          }
          className="rounded border border-deny/40 bg-deny/10 px-2 py-0.5 font-label-sm text-label-sm text-deny"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-label-sm text-label-sm text-outline underline"
        >
          Cancel
        </button>
      </span>
      {error ? <span className="font-body-sm text-[11px] text-deny">{error}</span> : null}
    </span>
  );
}
