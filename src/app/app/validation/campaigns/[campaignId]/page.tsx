import { notFound } from "next/navigation";

import { CampaignView } from "@/components/validation/CampaignView";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import {
  loadRunsWithSteps,
  toCampaignView,
  toFindingView,
  toRemediationView,
} from "@/lib/validation/read-model";

import { canDecideRemediation, canRunValidation } from "../../access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  if (!UUID.test(campaignId)) notFound();
  const { identity, context } = await createRepositoriesForCurrentTenant(
    `/app/validation/campaigns/${campaignId}`,
  );
  const db = context.supabase;
  const { data: row } = await db.from("validation_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!row) notFound();
  const [runs, findings] = await Promise.all([
    loadRunsWithSteps(db, campaignId),
    db.from("validation_findings").select("*").eq("campaign_id", campaignId).limit(500),
  ]);
  const ids = (findings.data ?? []).map((f) => f.id);
  const remediations = ids.length
    ? await db.from("validation_remediations").select("*").in("finding_id", ids)
    : { data: [] };

  return (
    <CampaignView
      initial={{
        campaign: toCampaignView(row),
        runs,
        findings: (findings.data ?? []).map(toFindingView),
        remediations: (remediations.data ?? []).map(toRemediationView),
      }}
      canRun={canRunValidation(identity.role)}
      canDecide={canDecideRemediation(identity.role)}
    />
  );
}
