"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { startCampaignAction } from "@/app/app/validation/actions";

import { humanize } from "./labels";
import { SeverityPill } from "./Pill";

export interface BuilderScenario {
  key: string;
  title: string;
  category: string;
  severity: string;
  variants: string[];
}
export interface BuilderPack {
  key: string;
  title: string;
  description: string;
  scenarioKeys: string[];
  variants: string[];
}
export interface BuilderEnv {
  id: string;
  name: string;
  expiresAt: string;
}

export function CampaignBuilder({
  environments,
  scenarios,
  packs,
  preselect,
  canRun,
}: {
  environments: BuilderEnv[];
  scenarios: BuilderScenario[];
  packs: BuilderPack[];
  preselect: { pack?: string; scenarios?: string[] };
  canRun: boolean;
}) {
  const initialPack = preselect.pack && packs.some((p) => p.key === preselect.pack) ? preselect.pack : null;
  const [mode, setMode] = useState<"pack" | "custom">(preselect.scenarios?.length ? "custom" : "pack");
  const [pack, setPack] = useState<string>(initialPack ?? packs[0]?.key ?? "");
  const [env, setEnv] = useState(environments[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(preselect.scenarios ?? []));
  const [variants, setVariants] = useState<Set<string>>(new Set(["baseline"]));
  const [repetitions, setRepetitions] = useState(1);
  const [seed, setSeed] = useState(1);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const allVariants = useMemo(
    () => ["baseline", ...new Set(scenarios.flatMap((s) => s.variants))],
    [scenarios],
  );
  const grouped = useMemo(() => {
    const m = new Map<string, BuilderScenario[]>();
    for (const s of scenarios) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()];
  }, [scenarios]);
  const chosenPack = packs.find((p) => p.key === pack);
  const runCount =
    mode === "pack"
      ? (chosenPack?.scenarioKeys.length ?? 0) * (chosenPack?.variants.length ?? 1) * repetitions
      : selected.size * variants.size * repetitions;

  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };

  if (environments.length === 0)
    return (
      <p className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg font-body-sm text-body-sm text-on-surface-variant">
        Create a validation environment first (Environments tab). It only takes a moment.
      </p>
    );

  return (
    <form
      className="flex flex-col gap-space-lg"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await startCampaignAction({
            environmentId: env,
            name,
            packKey: mode === "pack" ? pack : null,
            scenarioKeys: mode === "custom" ? [...selected] : undefined,
            variants: mode === "custom" ? [...variants] : undefined,
            repetitions,
            seed,
          });
          if (r.ok) router.push(`/app/validation/campaigns/${r.campaignId}`);
          else setError(r.error);
        });
      }}
    >
      <div className="grid gap-space-md sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
          Environment
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            className="rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface"
          >
            {environments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
          Campaign name (optional)
          <input
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface"
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-space-sm">
        <legend className="mb-1 font-headline-sm text-headline-sm text-on-surface">What to run</legend>
        <div className="flex gap-2">
          {(["pack", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-lg border px-3 py-1.5 font-body-sm text-body-sm ${
                mode === m
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-outline-variant/40 text-on-surface-variant"
              }`}
            >
              {m === "pack" ? "Scenario pack" : "Choose scenarios"}
            </button>
          ))}
        </div>
        {mode === "pack" ? (
          <div className="flex flex-col gap-2">
            {packs.map((p) => (
              <label
                key={p.key}
                className={`flex cursor-pointer gap-3 rounded-xl border p-space-md ${
                  pack === p.key
                    ? "border-primary/40 bg-primary/5"
                    : "border-outline-variant/30 bg-surface-container"
                }`}
              >
                <input type="radio" name="pack" checked={pack === p.key} onChange={() => setPack(p.key)} />
                <span>
                  <span className="block font-body-md text-body-md text-on-surface">{p.title}</span>
                  <span className="block font-body-sm text-body-sm text-on-surface-variant">
                    {p.description}
                  </span>
                  <span className="block font-mono-code text-[11px] text-outline">
                    {p.scenarioKeys.length} scenarios · variants: {p.variants.join(", ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-space-md">
            <div className="flex gap-2">
              <button
                type="button"
                className="font-body-sm text-body-sm text-primary underline"
                onClick={() => setSelected(new Set(scenarios.map((s) => s.key)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="font-body-sm text-body-sm text-primary underline"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
            {grouped.map(([cat, list]) => (
              <div key={cat}>
                <div className="font-mono-code text-[11px] uppercase text-outline">{humanize(cat)}</div>
                {list.map((s) => (
                  <label
                    key={s.key}
                    className="flex items-center gap-2 py-1 font-body-sm text-body-sm text-on-surface"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(s.key)}
                      onChange={() => toggle(selected, s.key, setSelected)}
                    />
                    {s.title} <SeverityPill severity={s.severity} />
                  </label>
                ))}
              </div>
            ))}
            <div>
              <div className="font-body-sm text-body-sm text-on-surface-variant">
                Control configurations (variants)
              </div>
              <div className="flex flex-wrap gap-3">
                {allVariants.map((v) => (
                  <label
                    key={v}
                    className="flex items-center gap-1.5 font-mono-code text-[12px] text-on-surface"
                  >
                    <input
                      type="checkbox"
                      checked={variants.has(v)}
                      onChange={() => toggle(variants, v, setVariants)}
                    />
                    {v}
                  </label>
                ))}
              </div>
              <p className="font-body-sm text-body-sm text-outline">
                Baseline is the recommended posture. Other variants deliberately weaken one control so you can
                see what it contributes; a variant only runs on scenarios that define it.
              </p>
            </div>
          </div>
        )}
      </fieldset>

      <div className="grid gap-space-md sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
          Repetitions (1–5)
          <input
            type="number"
            min={1}
            max={5}
            value={repetitions}
            onChange={(e) => setRepetitions(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
            className="rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface"
          />
        </label>
        <label className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
          Deterministic seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))}
            className="rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !canRun || runCount === 0}
          className="rounded-lg bg-primary px-4 py-2 font-body-sm text-body-sm font-medium text-on-primary disabled:opacity-50"
        >
          Start campaign
        </button>
        <span className="font-mono-code text-[12px] text-outline">
          up to {runCount} run(s) · synthetic · sandbox destroyed after each run
        </span>
        {!canRun ? (
          <span className="font-body-sm text-body-sm text-outline">Developers and above only.</span>
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
