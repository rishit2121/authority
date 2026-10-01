import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import type { Policy, PolicyEffect, PolicyStatus } from "@/lib/domain";

const EFFECT_LABEL: Record<PolicyEffect, string> = {
  allow: "Allow",
  deny: "Deny",
  require_approval: "Require approval",
};

const EFFECT_TONE: Record<PolicyEffect, StatusTone> = {
  allow: "positive",
  deny: "negative",
  require_approval: "attention",
};

const STATUS_LABEL: Record<PolicyStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

const STATUS_TONE: Record<PolicyStatus, StatusTone> = {
  draft: "neutral",
  active: "positive",
  archived: "muted",
};

function appliesTo(policy: Policy): string {
  if (policy.conditions.length === 0) return "All tasks";
  return policy.conditions.map((c) => c.key).join(", ");
}

function lastUpdated(policy: Policy): string {
  const date = policy.activatedAt ?? policy.createdAt;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Policies are immutable once active at the database level — changing one
 * means creating a new version, never editing this row. This table is
 * read-only; activation/editing is a later phase.
 */
export function PoliciesTable({ policies }: { policies: Policy[] }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-paper-raised">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <caption className="sr-only">Deterministic policies in this workspace</caption>
        <thead>
          <tr className="border-b border-line">
            {["Policy", "Effect", "Status", "Applies to", "Last updated"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-soft"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy.id} className="border-b border-line align-top last:border-b-0">
              <td className="px-4 py-3">
                <p className="text-[14px] text-ink">{policy.name}</p>
                {policy.description ? (
                  <p className="mt-0.5 max-w-sm text-[12px] text-ink-soft">{policy.description}</p>
                ) : null}
                {policy.conditions.length > 0 ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[12px] text-ink-soft underline decoration-line-strong underline-offset-2">
                      Technical details
                    </summary>
                    <pre className="mt-1.5 max-w-sm overflow-x-auto rounded-lg border border-line bg-paper px-2.5 py-2 font-mono-code text-[11px] text-ink-soft">
                      {JSON.stringify(policy.conditions, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <StatusPill tone={EFFECT_TONE[policy.effect]}>{EFFECT_LABEL[policy.effect]}</StatusPill>
              </td>
              <td className="px-4 py-3">
                <StatusPill tone={STATUS_TONE[policy.status]}>{STATUS_LABEL[policy.status]}</StatusPill>
              </td>
              <td className="px-4 py-3 text-[13px] text-ink-soft">{appliesTo(policy)}</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono-code text-[11px] text-ink-soft">
                {lastUpdated(policy)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
