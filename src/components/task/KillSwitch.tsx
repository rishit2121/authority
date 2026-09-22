"use client";

import { useState } from "react";

import { Icon } from "@/components/ui/Icon";

interface KillSwitchProps {
  /** Number of capabilities that would be revoked. */
  activeCapabilities: number;
  terminated: boolean;
  onConfirm: () => void;
}

/**
 * Terminates the task and revokes every live capability.
 *
 * Two-step by design: a destructive control that reaches production systems
 * should never fire on a single click. In this build the action is local
 * state only.
 */
export function KillSwitch({ activeCapabilities, terminated, onConfirm }: KillSwitchProps) {
  const [confirming, setConfirming] = useState(false);

  if (terminated) {
    return (
      <div className="rounded-xl border border-deny/40 bg-deny/10 p-space-lg">
        <h2 className="flex items-center gap-2 font-headline-sm text-headline-sm font-semibold text-deny">
          <Icon name="block" size={18} /> Task terminated
        </h2>
        <p className="mt-space-sm font-body-md text-body-md text-on-surface-variant">
          Task terminated. Active capabilities revoked; agent execution stopped. The termination was written
          to the execution timeline and the agent holds no remaining authority.
        </p>
        <p className="mt-space-md font-mono-code text-[11px] text-outline">
          Mocked control. No external system is contacted and no real repository is affected.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-deny/35 bg-surface-container p-space-lg">
      <h2 className="flex items-center gap-2 font-headline-sm text-headline-sm font-semibold text-on-surface">
        <Icon name="cancel" size={18} className="text-deny" /> Kill switch
      </h2>
      <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
        Immediately terminate this task and revoke its {activeCapabilities} active{" "}
        {activeCapabilities === 1 ? "capability" : "capabilities"}. The agent keeps running but loses every
        permission Authority issued to it.
      </p>

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="kill-confirm-heading"
          className="mt-space-lg rounded-lg border border-deny/40 bg-deny/10 p-space-md"
        >
          <h3 id="kill-confirm-heading" className="font-headline-sm text-body-md font-semibold text-deny">
            Revoke all authority for task #1842?
          </h3>
          <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
            This cannot be undone from this screen. Any in-flight tool call loses its credential at the
            gateway.
          </p>
          <div className="mt-space-md flex flex-wrap gap-space-sm">
            <button
              type="button"
              onClick={() => {
                onConfirm();
                setConfirming(false);
              }}
              className="rounded-lg bg-deny px-space-lg py-2 font-headline-sm text-body-md font-medium text-[#2b0007] transition-opacity hover:opacity-90"
            >
              Confirm revocation
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-outline-variant/40 bg-surface-container px-space-lg py-2 font-body-md text-body-md text-on-surface transition-colors hover:bg-surface-container-high"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-space-lg inline-flex items-center gap-2 rounded-lg border border-deny/50 bg-deny/10 px-space-lg py-2.5 font-headline-sm text-body-md font-medium text-deny transition-colors hover:bg-deny/20"
        >
          <Icon name="cancel" size={16} />
          Revoke all authority
        </button>
      )}

      <p className="mt-space-md font-mono-code text-[11px] text-outline">
        Mocked control. No external system is contacted and no real repository is affected.
      </p>
    </div>
  );
}
