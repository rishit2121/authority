"use client";

import { useState, useTransition } from "react";

import { setRetentionAction } from "@/app/app/settings/actions";

export function RetentionForm({ initialDays, canEdit }: { initialDays: number; canEdit: boolean }) {
  const [days, setDays] = useState(initialDays);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setRetentionAction(days);
          setMessage(r.ok ? "Saved." : (r.error ?? "Could not save."));
        });
      }}
    >
      <label className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
        Keep validation campaigns for (days, 7–365)
        <input
          type="number"
          min={7}
          max={365}
          value={days}
          disabled={!canEdit}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-32 rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface disabled:opacity-60"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canEdit || pending}
          className="rounded-lg bg-primary px-4 py-2 font-body-sm text-body-sm font-medium text-on-primary disabled:opacity-50"
        >
          Save retention
        </button>
        {!canEdit ? (
          <span className="font-body-sm text-body-sm text-outline">Admins and owners only.</span>
        ) : null}
        {message ? (
          <span role="status" className="font-body-sm text-body-sm text-on-surface-variant">
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
