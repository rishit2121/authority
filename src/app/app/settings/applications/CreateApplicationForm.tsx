"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createApplicationAction } from "./actions";

const ENVIRONMENTS = ["development", "staging", "production"] as const;

const INPUT =
  "rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";

export function CreateApplicationForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [environment, setEnvironment] = useState<(typeof ENVIRONMENTS)[number]>("development");
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg">
      <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">New application</h2>
      <form
        className="mt-space-sm flex flex-wrap items-end gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await createApplicationAction(name, slug, environment);
            if (result.ok && result.data) {
              router.push(`/app/settings/applications/${result.data.applicationId}`);
            } else {
              setError(result.error ?? "Could not create the application.");
            }
          });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Web"
            className={INPUT}
            data-testid="application-name"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Slug</span>
          <input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="acme-web"
            pattern="^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"
            className={INPUT}
            data-testid="application-slug"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
            Environment
          </span>
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as (typeof ENVIRONMENTS)[number])}
            className={INPUT}
            data-testid="application-environment"
          >
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="application-create">
          Create
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-space-sm font-body-sm text-body-sm text-deny">
          {error}
        </p>
      ) : null}
    </section>
  );
}
