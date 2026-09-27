import { SeverityPill } from "@/components/validation/Pill";
import { humanize } from "@/components/validation/labels";
import { PACKS, SCENARIOS } from "@/lib/validation/library";

export default function ScenarioLibraryPage() {
  const byCategory = new Map<string, typeof SCENARIOS>();
  for (const s of SCENARIOS) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);

  return (
    <div className="flex flex-col gap-space-lg">
      <section aria-label="Packs" className="grid gap-space-md md:grid-cols-2">
        {PACKS.map((p) => (
          <div
            key={p.key}
            className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
          >
            <div className="font-body-md text-body-md text-on-surface">{p.title}</div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{p.description}</p>
            <div className="font-mono-code text-[11px] text-outline">
              {p.key} · {p.scenarioKeys.length} scenarios ·{" "}
              {p.expectation === "all_pass" ? "must all pass" : "informational"}
            </div>
          </div>
        ))}
      </section>

      <p className="font-body-sm text-body-sm text-outline">
        {SCENARIOS.length} versioned, immutable scenarios. Taxonomy references are to OWASP and MITRE ATLAS
        identifiers and are shown only where the mapping is accurate; they are labels, not a compliance claim.
      </p>

      {[...byCategory.entries()].map(([cat, list]) => (
        <section key={cat} aria-label={humanize(cat)} className="flex flex-col gap-space-sm">
          <h2 className="font-mono-code text-[12px] uppercase text-outline">{humanize(cat)}</h2>
          {list.map((s) => (
            <details
              key={s.key}
              className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-md"
            >
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="font-body-md text-body-md text-on-surface">{s.title}</span>
                <SeverityPill severity={s.severity} />
                <span className="font-mono-code text-[11px] text-outline">
                  {s.key}@{s.version}
                  {s.variants.length ? ` · variants: ${s.variants.map((v) => v.label).join(", ")}` : ""}
                </span>
              </summary>
              <div className="mt-2 flex flex-col gap-2 font-body-sm text-body-sm text-on-surface-variant">
                <p>{s.description}</p>
                <p>
                  <span className="text-on-surface">Trusted task intent:</span> {s.intent}
                </p>
                <p>
                  <span className="text-on-surface">Candidate plan:</span>{" "}
                  {s.plan.map((n) => `${n.tool}×${n.maxInvocations}`).join(", ")}
                </p>
                <p>
                  <span className="text-on-surface">Steps:</span> {s.steps.length} (
                  {s.steps.filter((x) => x.kind === "attack").length} attack,{" "}
                  {s.steps.filter((x) => x.kind !== "attack").length} baseline/control)
                </p>
                {s.taxonomy.length ? (
                  <p className="font-mono-code text-[11px] text-outline">
                    {s.taxonomy.map((t) => `${t.framework} ${t.id} ${t.name}`).join(" · ")}
                  </p>
                ) : null}
              </div>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}
