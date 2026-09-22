import { Fragment } from "react";

import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

const PIPELINE = [
  {
    badge: "A",
    badgeClass: "border-primary/40 text-primary",
    title: "Support Agent",
    meta: "query_rows()",
    metaClass: "text-outline",
  },
  {
    badge: "G",
    badgeClass: "border-secondary/40 text-secondary",
    title: "Authority Gateway",
    meta: "Predicate Injection",
    metaClass: "text-allow",
  },
  {
    badge: "DB",
    badgeClass: "border-outline-variant/50 text-on-surface",
    title: "PostgreSQL Replica",
    meta: "customers table",
    metaClass: "text-outline",
  },
];

const PREDICATES = [
  { label: "ACCESS MODE", value: "READ_ONLY", valueClass: "text-allow" },
  { label: "ROW CONSTRAINT", value: "customer_id = 1842", valueClass: "text-primary" },
  { label: "COLUMN WHITELIST", value: "name, plan_status", valueClass: "text-on-surface" },
  { label: "TIME-TO-LIVE", value: "08m 42s remaining", valueClass: "text-secondary" },
];

export function DatabaseScoping() {
  return (
    <Section variant="band">
      <SectionHeading
        eyebrow="Row & Predicate Sandboxing"
        title="Micro-scoped database access for support & analytics agents."
        description="Never give an agent a full PostgreSQL connection string. Authority enforces dynamic parameter predicates at the wire protocol layer."
        className="max-w-2xl mb-space-2xl"
      />

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-xl">
        <div className="flex flex-col items-center justify-between gap-space-lg border-b border-outline-variant/20 pb-space-xl lg:flex-row">
          {PIPELINE.map((stage, index) => (
            <Fragment key={stage.title}>
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded border bg-surface-container-high font-mono-code text-sm ${stage.badgeClass}`}
                >
                  {stage.badge}
                </span>
                <span className="flex flex-col">
                  <span className="font-body-sm text-body-sm font-semibold text-on-surface">
                    {stage.title}
                  </span>
                  <span className={`font-mono-code text-[11px] ${stage.metaClass}`}>{stage.meta}</span>
                </span>
              </div>
              {index < PIPELINE.length - 1 ? (
                <Icon name="arrow_forward" size={20} className="rotate-90 text-outline lg:rotate-0" />
              ) : null}
            </Fragment>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-space-md pt-space-lg font-mono-code text-[12px] md:grid-cols-4">
          {PREDICATES.map((item) => (
            <div
              key={item.label}
              className="rounded border border-outline-variant/20 bg-surface-container-low p-space-md"
            >
              <span className="block text-[10px] uppercase text-outline">{item.label}</span>
              <span className={`font-semibold ${item.valueClass}`}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
