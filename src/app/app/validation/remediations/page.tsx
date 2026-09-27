import Link from "next/link";

import { AutoRefresh } from "@/components/validation/AutoRefresh";
import { RemediationCard } from "@/components/validation/RemediationCard";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { toRemediationView } from "@/lib/validation/read-model";

import { canDecideRemediation } from "../access";

export default async function RemediationsPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/validation/remediations");
  const { data } = await context.supabase
    .from("validation_remediations")
    .select("*, validation_findings(title, campaign_id, severity)")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []).map((r) => ({
    remediation: toRemediationView(r),
    finding: (
      r as unknown as { validation_findings: { title: string; campaign_id: string; severity: string } | null }
    ).validation_findings,
  }));
  const order = ["proposed", "accepted", "failed_verification", "verified", "rejected"];
  rows.sort((a, b) => order.indexOf(a.remediation.status) - order.indexOf(b.remediation.status));
  const canDecide = canDecideRemediation(identity.role);

  return (
    <div className="flex flex-col gap-space-md">
      <AutoRefresh active={rows.some((r) => r.remediation.status === "accepted")} />
      <p className="max-w-3xl font-body-sm text-body-sm text-on-surface-variant">
        Proposals only ever narrow authority. Accepting one records your decision, pins a regression test and
        reruns the attack in a sandbox with the fix applied so you can see it work. Applying it to a real
        contract or policy is a separate, deliberate change.
      </p>
      {rows.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">No remediation proposals yet.</p>
      ) : null}
      {rows.map(({ remediation, finding }) => (
        <div key={remediation.id} className="flex flex-col gap-1">
          {finding ? (
            <Link
              href={`/app/validation/campaigns/${finding.campaign_id}`}
              className="font-mono-code text-[11px] text-outline underline"
            >
              {finding.severity} · {finding.title}
            </Link>
          ) : null}
          <RemediationCard remediation={remediation} canDecide={canDecide} />
        </div>
      ))}
    </div>
  );
}
