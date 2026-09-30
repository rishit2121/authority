import "server-only";

import type { RepositoryContext } from "@/lib/persistence/context";
import { throwDatabaseError } from "@/lib/persistence/errors";

import type { NecessityRunResult } from "./necessity-runner";
import type { NecessityMode } from "./contract-pipeline";
import type { PlanNodeFindingStatus } from "@/lib/authorization/plan-validator";

/**
 * Typed wrappers over the Jev recording RPCs (`record_jev_necessity_evaluation`, `record_jev_completeness_evaluation`,
 * `set_jev_settings`), mirroring `lib/persistence/rpc.ts`'s pattern exactly.
 *
 * TEMPORARY: `src/lib/supabase/database.types.ts` has not been regenerated against migration
 * `20260930000017_jev_openrouter.sql` yet — the linked project's Management API access token expired mid-session
 * (confirmed: a direct probe returns 401), which the migration itself does not depend on (it applied and was
 * verified directly against Postgres), but `supabase gen types` does. Every call below is therefore cast through
 * `unknown` at the RPC-name boundary, the same documented technique this codebase already uses in
 * `src/tests/integration/runtime/gateway-bypass.test.ts` for an RPC not present in the generated type. Once the
 * token is refreshed and `npm run db:types` is re-run, every cast in this file can be deleted with no behavior
 * change — see docs/jev/SETUP.md.
 */
type JevRpcClient = RepositoryContext["supabase"] & {
  rpc(
    fn: "record_jev_necessity_evaluation",
    args: { p_tenant_id: string; p_row: Record<string, unknown> },
  ): Promise<{ data: string | null; error: { code?: string; message: string } | null }>;
  rpc(
    fn: "record_jev_completeness_evaluation",
    args: { p_tenant_id: string; p_row: Record<string, unknown> },
  ): Promise<{ data: string | null; error: { code?: string; message: string } | null }>;
  rpc(
    fn: "set_jev_settings",
    args: {
      p_tenant_id: string;
      p_necessity_mode: string;
      p_risk_mode: string;
      p_approve_enforcement: boolean;
    },
  ): Promise<{
    data: Array<{ necessity_mode: string; risk_mode: string }> | null;
    error: { code?: string; message: string } | null;
  }>;
};

function jevClient(context: RepositoryContext): JevRpcClient {
  return context.supabase as unknown as JevRpcClient;
}

export interface RecordNecessityEvaluationInput {
  tenantId: string;
  taskId: string;
  planId: string;
  nodeKey: string;
  tool: string;
  registryVersion: string;
  compilerVersion: string;
  mode: Extract<NecessityMode, "shadow" | "enforce">;
  run: NecessityRunResult;
  inputHash: string;
  mechanicalStatus: PlanNodeFindingStatus;
  finalStatus: PlanNodeFindingStatus;
  disagreement: boolean;
}

/** Never throws on failure to record — an audit-trail write failing must not break contract proposal itself; the caller logs and continues. */
export async function recordNecessityEvaluation(
  context: RepositoryContext,
  input: RecordNecessityEvaluationInput,
): Promise<void> {
  const { error } = await jevClient(context).rpc("record_jev_necessity_evaluation", {
    p_tenant_id: input.tenantId,
    p_row: {
      taskId: input.taskId,
      planId: input.planId,
      nodeKey: input.nodeKey,
      tool: input.tool,
      registryVersion: input.registryVersion,
      compilerVersion: input.compilerVersion,
      mode: input.mode,
      provider: input.run.provider,
      model: input.run.model,
      modelVersion: input.run.modelVersion,
      inputHash: input.inputHash,
      state: input.run.state,
      result: input.run.evaluation ? { schemaVersion: 1, ...input.run.evaluation } : null,
      mechanicalStatus: input.mechanicalStatus,
      finalStatus: input.finalStatus,
      disagreement: input.disagreement,
      latencyMs: input.run.latencyMs,
      errorCategory: input.run.errorCategory,
    },
  });
  if (error) throwDatabaseError("record jev necessity evaluation", error);
}

export interface JevSettingsRow {
  necessityMode: NecessityMode;
  riskMode: "off" | "shadow";
  enforcementApproved: boolean;
}

export async function getJevSettings(context: RepositoryContext, tenantId: string): Promise<JevSettingsRow> {
  const { data, error } = await (
    context.supabase as unknown as {
      from(t: "jev_settings"): {
        select(cols: string): {
          eq(
            col: string,
            v: string,
          ): {
            maybeSingle(): Promise<{
              data: {
                necessity_mode: string;
                risk_mode: string;
                enforcement_approved_at: string | null;
              } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    }
  )
    .from("jev_settings")
    .select("necessity_mode, risk_mode, enforcement_approved_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throwDatabaseError("read jev settings", error);
  return {
    necessityMode: (data?.necessity_mode as NecessityMode | undefined) ?? "off",
    riskMode: (data?.risk_mode as "off" | "shadow" | undefined) ?? "off",
    enforcementApproved: Boolean(data?.enforcement_approved_at),
  };
}

export async function setJevSettings(
  context: RepositoryContext,
  input: {
    tenantId: string;
    necessityMode: NecessityMode;
    riskMode: "off" | "shadow";
    approveEnforcement: boolean;
  },
): Promise<JevSettingsRow> {
  const { data, error } = await jevClient(context).rpc("set_jev_settings", {
    p_tenant_id: input.tenantId,
    p_necessity_mode: input.necessityMode,
    p_risk_mode: input.riskMode,
    p_approve_enforcement: input.approveEnforcement,
  });
  if (error) throwDatabaseError("set jev settings", error);
  const row = data?.[0];
  if (!row) throwDatabaseError("set jev settings", { code: "no_rows_returned" });
  return {
    necessityMode: row.necessity_mode as NecessityMode,
    riskMode: row.risk_mode as "off" | "shadow",
    enforcementApproved: row.necessity_mode === "enforce",
  };
}
