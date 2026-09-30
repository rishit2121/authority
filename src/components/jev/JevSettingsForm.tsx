"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateJevSettingsAction } from "@/app/app/settings/actions";
import type { NecessityMode } from "@/lib/jev/contract-pipeline";

export interface JevSettingsFormProps {
  initial: {
    necessityMode: NecessityMode;
    riskMode: "off" | "shadow";
    enforcementApproved: boolean;
  };
  canEdit: boolean;
  planModelConfigured: boolean;
  decisionModelConfigured: boolean;
}

const field =
  "rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface disabled:opacity-60";

export function JevSettingsForm({
  initial,
  canEdit,
  planModelConfigured,
  decisionModelConfigured,
}: JevSettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [necessityMode, setNecessityMode] = useState(initial.necessityMode);
  const [riskMode, setRiskMode] = useState(initial.riskMode);
  const [approve, setApprove] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const disabled = !canEdit || pending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateJevSettingsAction({ necessityMode, riskMode, approveEnforcement: approve });
      setMessage({ ok: result.ok, text: result.ok ? "Saved." : (result.error ?? "Could not save.") });
      if (result.ok) {
        setApprove(false);
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-xl flex-col gap-space-md"
      aria-label="Jev evaluation settings"
    >
      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Necessity mode
        <select
          data-testid="jev-necessity-mode"
          className={field}
          value={necessityMode}
          onChange={(e) => setNecessityMode(e.target.value as NecessityMode)}
          disabled={disabled}
        >
          <option value="off">Off — no per-tool necessity evaluation</option>
          <option value="shadow">Shadow — evaluate and record, never remove a tool</option>
          <option value="enforce">Enforce — Jev can remove tools it classifies as not required</option>
        </select>
        <span className="font-body-sm text-body-sm text-outline">
          Jev never authorizes, widens scope or invents a tool. In enforce mode it can only narrow a candidate
          plan to a subset of the tools the deterministic pipeline already found reachable; the exact
          minimum-authority solver, compiler, verifier and approval lifecycle are unchanged and remain
          authoritative.
        </span>
      </label>

      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Runtime risk mode
        <select
          data-testid="jev-risk-mode"
          className={field}
          value={riskMode}
          onChange={(e) => setRiskMode(e.target.value as typeof riskMode)}
          disabled={disabled}
        >
          <option value="off">Off — no runtime risk evaluation</option>
          <option value="shadow">Shadow — evaluate and record, never affect a decision</option>
        </select>
        <span className="font-body-sm text-body-sm text-outline">
          Runtime risk evaluation has no enforce mode yet: it can only ever record evidence beside the
          deterministic decision, which is always final. Enforcement will require a future migration and its
          own explicit approval.
        </span>
      </label>

      {necessityMode === "enforce" ? (
        <label className="flex items-start gap-2 font-body-sm text-body-sm text-on-surface">
          <input
            type="checkbox"
            data-testid="jev-approve-enforcement"
            checked={approve}
            onChange={(e) => setApprove(e.target.checked)}
            disabled={disabled}
          />
          <span>
            I approve Jev necessity evaluation narrowing candidate plans in this workspace.
            {initial.enforcementApproved
              ? " (An approval for necessity enforcement is already on record.)"
              : ""}
          </span>
        </label>
      ) : null}

      <p data-testid="jev-model-status" className="font-body-sm text-body-sm text-on-surface-variant">
        Plan-proposal model (<code className="font-mono-code">OPENROUTER_PLAN_MODEL</code>):{" "}
        <strong>{planModelConfigured ? "configured on the server" : "not configured"}</strong>. Direct Jev
        decision model (<code className="font-mono-code">OPENROUTER_JEV_DECISION_MODEL</code>):{" "}
        <strong>{decisionModelConfigured ? "configured on the server" : "not configured"}</strong>. Necessity
        and risk evaluation stay unavailable — and are reported as such, never silently skipped or mocked —
        until the decision model is configured. Keys are read from the server environment and are never
        entered, stored or displayed here.
      </p>

      {canEdit ? (
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary disabled:opacity-50"
        >
          Save settings
        </button>
      ) : (
        <p className="font-body-sm text-body-sm text-outline">
          Only security admins and above can change these settings.
        </p>
      )}
      {message ? (
        <p role="status" className={`font-body-sm text-body-sm ${message.ok ? "text-allow" : "text-deny"}`}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
