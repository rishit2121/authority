"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateSemanticSettingsAction } from "@/app/app/settings/actions";

export interface SemanticSettingsFormProps {
  initial: { mode: "off" | "shadow"; provider: string; model: string; timeoutMs: number };
  canEdit: boolean;
  apiKeyConfigured: boolean;
}

const field =
  "rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface disabled:opacity-60";

export function SemanticSettingsForm({ initial, canEdit, apiKeyConfigured }: SemanticSettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState(initial.mode);
  const [provider, setProvider] = useState(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [timeoutMs, setTimeoutMs] = useState(String(initial.timeoutMs));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateSemanticSettingsAction({
        mode,
        provider,
        model,
        timeoutMs: Number(timeoutMs),
      });
      setMessage({ ok: result.ok, text: result.ok ? "Saved." : (result.error ?? "Could not save.") });
      if (result.ok) router.refresh();
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
          onChange={(e) => setMode(e.target.value as "off" | "shadow")}
          disabled={!canEdit || pending}
        >
          <option value="off">Off — no semantic evaluation</option>
          <option value="shadow">Shadow — evaluate and record, never affect decisions</option>
          <option value="enforce" disabled>
            Enforce — unavailable
          </option>
        </select>
        <span className="font-body-sm text-body-sm text-outline">
          Enforce is unavailable: direct callers of the authorization RPC can bypass any check made outside
          the database, so a semantic verdict cannot yet be enforced (see docs/semantic/SHADOW_MODE.md).
        </span>
      </label>

      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Provider
        <select
          className={field}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={!canEdit || pending}
        >
          <option value="mock">mock — deterministic rule-based heuristics</option>
          <option value="legacy_lexical">legacy_lexical — original lexical-overlap baseline</option>
          <option value="openai_compatible">
            openai_compatible — hosted chat model (needs server API key)
          </option>
        </select>
      </label>

      <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
        Model
        <input
          className={field}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={!canEdit || pending}
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
          disabled={!canEdit || pending}
        />
      </label>

      <p data-testid="api-key-status" className="font-body-sm text-body-sm text-on-surface-variant">
        Provider API key: <strong>{apiKeyConfigured ? "configured on the server" : "not configured"}</strong>.
        The key is read from the server environment (<code>SEMANTIC_PROVIDER_API_KEY</code>) and is never
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
