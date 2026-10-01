import { RetentionForm } from "@/components/settings/RetentionForm";
import { SemanticSettingsForm } from "@/components/semantic/SemanticSettingsForm";
import { JevSettingsForm } from "@/components/jev/JevSettingsForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { TENANT_ROLE_RANK } from "@/lib/domain";
import { getJevSettings } from "@/lib/jev/persistence";
import { getOpenRouterEnv } from "@/lib/openrouter/env";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { snapshotBreakers } from "@/lib/semantic/circuit-breaker";
import { getSemanticProviderEnv } from "@/lib/semantic/openai-compatible-provider";
import { lastMaintenance } from "@/lib/maintenance";
import { EVIDENCE_COLUMNS, summarizeHealth, toEvidenceView } from "@/lib/semantic/read-model";

export default async function SettingsPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/settings");

  const { data: settings } = await context.supabase
    .from("semantic_settings")
    .select(
      "mode, provider, model, timeout_ms, semantic_required_classes, capability_ttl_seconds, enforcement_approved_at",
    )
    .eq("tenant_id", identity.tenant.tenantId)
    .maybeSingle();

  const { data: evidenceRows } = await context.supabase
    .from("semantic_shadow_evaluations")
    .select(EVIDENCE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const canSeeAuthEvents = TENANT_ROLE_RANK[identity.role] >= TENANT_ROLE_RANK.security_admin;
  const authCounts = canSeeAuthEvents
    ? await Promise.all(
        (["success", "invalid_credential", "revoked_credential", "rate_limited"] as const).map(
          async (outcome) => {
            const { count } = await context.supabase
              .from("agent_auth_events")
              .select("id", { count: "exact", head: true })
              .eq("outcome", outcome)
              .gte("created_at", since);
            return [outcome, count ?? 0] as const;
          },
        ),
      )
    : null;
  const { data: retention } = await context.supabase
    .from("tenant_retention_settings")
    .select("validation_days")
    .eq("tenant_id", identity.tenant.tenantId)
    .maybeSingle();
  const maintenance = lastMaintenance();
  const canEditRetention = TENANT_ROLE_RANK[identity.role] >= TENANT_ROLE_RANK.admin;

  const health = summarizeHealth((evidenceRows ?? []).map(toEvidenceView));
  const breakers = snapshotBreakers();
  const canEdit = TENANT_ROLE_RANK[identity.role] >= TENANT_ROLE_RANK.security_admin;
  const mode = settings?.mode === "shadow" || settings?.mode === "enforce" ? settings.mode : "off";

  const jevSettings = await getJevSettings(context, identity.tenant.tenantId).catch(() => ({
    necessityMode: "off" as const,
    riskMode: "off" as const,
    enforcementApproved: false,
  }));
  const openRouterEnv = getOpenRouterEnv();

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Settings"
        description="Runtime enforcement, AI providers, and validation data retention for this workspace."
      />

      <section
        aria-labelledby="semantic-settings-heading"
        className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      >
        <h2
          id="semantic-settings-heading"
          className="font-headline-sm text-headline-sm font-semibold text-on-surface"
        >
          AI risk signal
        </h2>
        <p className="mb-space-md mt-space-sm max-w-2xl font-body-sm text-body-sm text-on-surface-variant">
          The deterministic engine remains the security boundary. Semantic models add evidence beside each
          decision; they cannot allow, widen, activate or grant anything.
        </p>
        <SemanticSettingsForm
          canEdit={canEdit}
          apiKeyConfigured={getSemanticProviderEnv() !== null}
          secondaryKeyConfigured={(getSemanticProviderEnv()?.apiKeys.length ?? 0) > 1}
          environment={identity.tenant.environment}
          initial={{
            mode,
            provider: settings?.provider ?? "mock",
            model: settings?.model ?? "mock-heuristic",
            timeoutMs: settings?.timeout_ms ?? 800,
            requiredClasses: (settings?.semantic_required_classes ?? []) as ("low" | "medium" | "high")[],
            capabilityTtlSeconds: settings?.capability_ttl_seconds ?? 60,
            enforcementApproved: Boolean(settings?.enforcement_approved_at),
          }}
        />
      </section>

      <section
        aria-labelledby="jev-settings-heading"
        className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      >
        <h2
          id="jev-settings-heading"
          className="font-headline-sm text-headline-sm font-semibold text-on-surface"
        >
          Jev (OpenRouter) evaluation
        </h2>
        <p className="mb-space-md mt-space-sm max-w-2xl font-body-sm text-body-sm text-on-surface-variant">
          Jev independently checks whether each tool in a proposed plan is genuinely necessary and, at
          runtime, supplies semantic risk evidence. It never issues, widens or replaces an authorization
          decision — the registry, mechanical validation, minimum-authority solver, compiler, verifier and
          approval lifecycle remain authoritative and unmodified.
        </p>
        <JevSettingsForm
          canEdit={canEdit}
          planModelConfigured={openRouterEnv !== null}
          decisionModelConfigured={openRouterEnv?.jevDecisionModel != null}
          initial={jevSettings}
        />
      </section>

      <section
        aria-labelledby="semantic-health-heading"
        className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      >
        <h2
          id="semantic-health-heading"
          className="font-headline-sm text-headline-sm font-semibold text-on-surface"
        >
          Provider health
        </h2>
        <p className="mt-space-sm max-w-2xl font-body-sm text-body-sm text-on-surface-variant">
          Computed from the most recent {evidenceRows?.length ?? 0} persisted shadow evaluations.
          Circuit-breaker state below is per server process and resets on restart.
        </p>
        {health.length === 0 ? (
          <p className="mt-space-md font-body-sm text-body-sm text-outline">
            No semantic evaluations recorded yet.
          </p>
        ) : (
          <div className="mt-space-md overflow-auto">
            <table className="w-full min-w-[640px] border-collapse text-left font-mono-code text-[11px]">
              <caption className="sr-only">Semantic provider health</caption>
              <thead>
                <tr className="border-b border-outline-variant/30 text-outline">
                  {[
                    "Provider / model",
                    "Evaluations",
                    "OK",
                    "Timeout",
                    "Error",
                    "Unavailable",
                    "Circuit open",
                    "p50",
                    "p95",
                  ].map((h) => (
                    <th key={h} scope="col" className="px-2 py-1 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {health.map((h) => (
                  <tr
                    key={h.provider}
                    className="border-b border-outline-variant/20 last:border-b-0 text-on-surface"
                  >
                    <td className="px-2 py-1">{h.provider}</td>
                    <td className="px-2 py-1">{h.total}</td>
                    <td className="px-2 py-1">{h.ok}</td>
                    <td className="px-2 py-1">{h.timeout}</td>
                    <td className="px-2 py-1">{h.error}</td>
                    <td className="px-2 py-1">{h.unavailable}</td>
                    <td className="px-2 py-1">{h.circuitOpen}</td>
                    <td className="px-2 py-1">{h.p50LatencyMs} ms</td>
                    <td className="px-2 py-1">{h.p95LatencyMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {breakers.length > 0 ? (
          <ul className="mt-space-md font-mono-code text-[11px] text-on-surface-variant">
            {breakers.map((b) => (
              <li key={b.key}>
                breaker {b.key}: {b.state} ({b.consecutiveFailures} consecutive failures)
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section
        aria-labelledby="operations-heading"
        className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      >
        <h2
          id="operations-heading"
          className="font-headline-sm text-headline-sm font-semibold text-on-surface"
        >
          Rate limits, retention and operations
        </h2>
        <div className="mt-space-md grid gap-space-lg lg:grid-cols-2">
          <div>
            <h3 className="font-body-md text-body-md text-on-surface">Rate limits</h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Agent credentials: after 20 failed attempts within 60 seconds from one key prefix, further
              attempts are refused with <code className="font-mono-code">RATE_LIMITED</code> until the window
              clears. Successful calls are not throttled by this limit.
            </p>
            {authCounts ? (
              <table className="mt-2 font-mono-code text-[12px] text-on-surface">
                <caption className="sr-only">Agent authentication outcomes in the last 24 hours</caption>
                <tbody>
                  {authCounts.map(([outcome, n]) => (
                    <tr key={outcome}>
                      <th scope="row" className="pr-4 text-left font-normal text-on-surface-variant">
                        {outcome.replace("_", " ")} (24h)
                      </th>
                      <td>{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 font-body-sm text-body-sm text-outline">
                Authentication counts are visible to security admins and above.
              </p>
            )}
            <p className="mt-2 font-mono-code text-[11px] text-outline">
              Attempts with an unknown key are recorded without a tenant and are not counted here.
            </p>
          </div>
          <div>
            <h3 className="font-body-md text-body-md text-on-surface">Retention</h3>
            <RetentionForm initialDays={retention?.validation_days ?? 30} canEdit={canEditRetention} />
            <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">
              Applies to Validation Lab campaigns (synthetic, reproducible from immutable scenario versions).
              Decisions, approvals, receipts and authentication events are append-only audit records and are
              kept; automatic deletion of those is not offered.
            </p>
            <p className="mt-2 font-mono-code text-[11px] text-outline">
              {maintenance
                ? `Last maintenance run ${maintenance.ranAt} (${maintenance.durationMs} ms${
                    maintenance.errors.length ? `, issues: ${maintenance.errors.join(", ")}` : ", no issues"
                  }) — this server process only.`
                : "Maintenance has not run in this server process yet (it runs every 5 minutes in production)."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
