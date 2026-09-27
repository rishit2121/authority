import { CampaignBuilder } from "@/components/validation/CampaignBuilder";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { PACKS, SCENARIOS } from "@/lib/validation/library";

import { canRunValidation } from "../../access";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/validation/campaigns/new");
  const { data: envs } = await context.supabase
    .from("validation_environments")
    .select("id, name, expires_at")
    .gt("expires_at", new Date().toISOString())
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  return (
    <CampaignBuilder
      environments={(envs ?? []).map((e) => ({ id: e.id, name: e.name, expiresAt: e.expires_at }))}
      scenarios={SCENARIOS.map((s) => ({
        key: s.key,
        title: s.title,
        category: s.category,
        severity: s.severity,
        variants: s.variants.map((v) => v.label),
      }))}
      packs={PACKS.map((p) => ({
        key: p.key,
        title: p.title,
        description: p.description,
        scenarioKeys: p.scenarioKeys,
        variants: p.variants,
      }))}
      preselect={{
        pack: params.pack,
        scenarios: params.scenarios
          ?.split(",")
          .filter((k) => k.length > 0 && k.length < 100)
          .slice(0, 60),
      }}
      canRun={canRunValidation(identity.role)}
    />
  );
}
