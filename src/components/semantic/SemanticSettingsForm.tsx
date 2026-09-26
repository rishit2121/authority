"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateSemanticSettingsAction } from "@/app/app/settings/actions";
import {
  RISK_CLASSES,
  providerEnforcementGrade,
  type RiskClassName,
  type TenantEnvironment,
} from "@/lib/semantic/enforcement-grade";

export interface SemanticSettingsFormProps {
  initial: {
    mode: "off" | "shadow" | "enforce";
    provider: string;
    model: string;
    timeoutMs: number;
    requiredClasses: RiskClassName[];
    capabilityTtlSeconds: number;
    enforcementApproved: boolean;
  };
  environment: TenantEnvironment;
  canEdit: boolean;
  apiKeyConfigured: boolean;
  secondaryKeyConfigured: boolean;
}

const field =
  "rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface disabled:opacity-60";

export function SemanticSettingsForm({
  initial,
  environment,
  canEdit,
  apiKeyConfigured,
  secondaryKeyConfigured,
}: SemanticSettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState(initial.mode);
  const [provider, setProvider] = useState(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [timeoutMs, setTimeoutMs] = useState(String(initial.timeoutMs));
  const [ttl, setTtl] = useState(String(initial.capabilityTtlSeconds));
  const [classes, setClasses] = useState<RiskClassName[]>(initial.requiredClasses);
  const [approve, setApprove] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const grade = providerEnforcementGrade(provider, environment);
  const disabled = !canEdit || pending;

  function toggleClass(c: RiskClassName) {
    setClasses((current) => (current.includes(c) ? current.filter((x) => x !== c) : [...current, c]));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateSemanticSettingsAction({
        mode,
        provider,
        model,
        timeoutMs: Number(timeoutMs),
        requiredClasses: classes,
        capabilityTtlSeconds: Number(ttl),
        approveEnforcement: approve,
      });
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
      aria-label="Semantic evaluation settings"
    >
      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Mode
        <select
          data-testid="semantic-mode"
          className={field}
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          disabled={disabled}
        >
          <option value="off">Off — no semantic evaluation</option>
          <option value="shadow">Shadow — evaluate and record, never affect decisions</option>
          <option value="enforce">Enforce — semantic risk can narrow an allow</option>
        </select>
        <span className="font-body-sm text-body-sm text-outline">
          Enforcement can only narrow a deterministic allow (to deny or require approval). It can never widen
          anything, and it is refused unless the provider is enforcement-grade for this workspace and you
          approve it below.
        </span>
      </label>

      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Provider
        <select
          data-testid="semantic-provider"
          className={field}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={disabled}
        >
          <option value="mock">mock — deterministic rule-based heuristics</option>
          <option value="legacy_lexical">legacy_lexical — original lexical-overlap baseline</option>
          <option value="openai_compatible">
            openai_compatible — hosted chat model (needs server API key)
          </option>
        </select>
        <span
          data-testid="enforcement-grade"
          className={`font-body-sm text-body-sm ${grade ? "text-allow" : "text-secondary"}`}
        >
          {grade
            ? provider === "openai_compatible"
              ? "Enforcement-grade: a hosted model."
              : "Enforcement allowed only because this is a development workspace — this heuristic is not production-grade enforcement."
            : `Not enforcement-grade in a ${environment} workspace: this heuristic can run in shadow mode only.`}
        </span>
      </label>

      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Model
        <input
          className={field}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={disabled}
          maxLength={100}
        />
      </label>

      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Timeout (ms, 100–5000)
        <input
          className={field}
          inputMode="numeric"
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(e.target.value)}
          disabled={disabled}
        />
      </label>

      <fieldset className="flex flex-col gap-1" disabled={disabled}>
        <legend className="font-label-md text-label-md text-on-surface">
          Semantic evaluation is REQUIRED for
        </legend>
        <div className="flex gap-4">
          {RISK_CLASSES.map((c) => (
            <label key={c} className="flex items-center gap-1 font-body-sm text-body-sm text-on-surface">
              <input
                type="checkbox"
                data-testid={`required-${c}`}
                checked={classes.includes(c)}
                onChange={() => toggleClass(c)}
              />
              {c}-risk calls
            </label>
          ))}
        </div>
        <span className="font-body-sm text-body-sm text-outline">
          In enforce mode, a required call fails closed (deny) if the semantic evaluation times out, returns
          malformed output, is unavailable or the circuit is open. Other calls keep the deterministic result
          and record the degraded state.
        </span>
      </fieldset>

      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Capability lifetime (seconds, 5–900)
        <input
          className={field}
          inputMode="numeric"
          value={ttl}
          onChange={(e) => setTtl(e.target.value)}
          disabled={disabled}
        />
        <span className="font-body-sm text-body-sm text-outline">
          A capability is never valid past its contract&apos;s expiry, and is single-use unless a call
          explicitly asks for a bounded number of uses.
        </span>
      </label>

      {mode === "enforce" ? (
        <label className="flex items-start gap-2 font-body-sm text-body-sm text-on-surface">
          <input
            type="checkbox"
            data-testid="approve-enforcement"
            checked={approve}
            onChange={(e) => setApprove(e.target.checked)}
            disabled={disabled}
          />
          <span>
            I approve <strong>{provider}</strong> / <strong>{model}</strong> to narrow authorization decisions
            in this workspace.
            {initial.enforcementApproved
              ? " (An approval for the current provider and model is already on record.)"
              : ""}
          </span>
        </label>
      ) : null}

      <p data-testid="api-key-status" className="font-body-sm text-body-sm text-on-surface-variant">
        Provider API key: <strong>{apiKeyConfigured ? "configured on the server" : "not configured"}</strong>
        {secondaryKeyConfigured ? " (a rotation key is also configured)" : ""}. Keys are read from the server
        environment and are never entered, stored or displayed here.
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
