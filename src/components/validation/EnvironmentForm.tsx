"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createEnvironmentAction } from "@/app/app/validation/actions";

export function EnvironmentForm({ disabled }: { disabled: boolean }) {
  const [name, setName] = useState("Local validation");
  const [ttl, setTtl] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <form
      className="flex flex-col gap-space-md rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await createEnvironmentAction({ name, ttlHours: ttl });
          if (r.ok) router.refresh();
          else setError(r.error);
        });
      }}
    >
      <h3 className="font-headline-sm text-headline-sm text-on-surface">New validation environment</h3>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        An environment is a set of limits. Every run gets its own throwaway sandbox tenant with synthetic
        users, agents and a mock GitHub. Nothing here can reach real integrations, and it expires
        automatically.
      </p>
      <label className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
        Name
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface"
        />
      </label>
      <label className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
        Expires after (hours)
        <input
          type="number"
          min={1}
          max={72}
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
          className="w-32 rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface"
        />
      </label>
      <div>
        <button
          type="submit"
          disabled={pending || disabled}
          className="rounded-lg bg-primary px-4 py-2 font-body-sm text-body-sm font-medium text-on-primary disabled:opacity-50"
        >
          Create environment
        </button>
        {disabled ? (
          <span className="ml-3 font-body-sm text-body-sm text-outline">Developers and above only.</span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="font-body-sm text-body-sm text-deny">
          {error}
        </p>
      ) : null}
    </form>
  );
}
