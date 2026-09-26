import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Thin wrapper over the `authorize_tool_call()` RPC — the one runtime
 * authorization entry point (see the migration's own module doc for the
 * full trust boundary). This module owns exactly one thing: translating
 * between the RPC's SQL-shaped input/output and a typed TypeScript result,
 * including mapping the RPC's SQLSTATE codes to a closed set of error
 * reasons the route handler turns into HTTP responses. It performs no
 * authorization logic of its own — the RPC is the authority.
 */

export interface AuthorizeToolCallInput {
  credentialSecret: string;
  taskId: string;
  tool: string;
  operation: string;
  resource?: string;
  arguments?: Record<string, unknown>;
  planNodeId?: string;
  idempotencyKey: string;
  executionContext?: Record<string, unknown>;
  currentRegistryVersion: string;
  currentCompilerVersion: string;
}

export type AuthorizeOutcome =
  "allow" | "allow_constrained" | "replan" | "clarify" | "require_approval" | "deny";

export interface AuthorizeToolCallResult {
  decisionId: string;
  toolRequestId: string;
  outcome: AuthorizeOutcome;
  reasonCodes: string[];
  contractId: string | null;
  contractVersion: number | null;
  remainingInvocations: number | null;
  wasReplayed: boolean;
}

export type AuthorizeFailureReason =
  | "invalid_credential"
  | "forbidden"
  | "not_found"
  | "idempotency_conflict"
  | "rate_limited"
  | "invalid_request"
  | "unknown";

export class AuthorizeToolCallError extends Error {
  readonly reason: AuthorizeFailureReason;

  constructor(reason: AuthorizeFailureReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthorizeToolCallError";
    this.reason = reason;
  }
}

/** Maps a Postgres SQLSTATE raised by authorize_tool_call() to a closed failure reason. Never trust message text — see the RPC's own `raise exception` sites for the authoritative codes. */
function reasonForSqlState(code: string | undefined): AuthorizeFailureReason {
  switch (code) {
    case "28000":
      return "invalid_credential";
    case "42501":
      return "forbidden";
    case "P0002":
      return "not_found";
    case "23505":
      return "idempotency_conflict";
    case "53400":
      return "rate_limited";
    case "22023":
      return "invalid_request";
    default:
      return "unknown";
  }
}

export async function authorizeToolCall(
  supabase: SupabaseClient<Database>,
  input: AuthorizeToolCallInput,
): Promise<AuthorizeToolCallResult> {
  // authorize_tool_call()'s SQL parameters have no `default` clauses (every
  // argument is meaningful, even when null), so the generated Args type
  // treats p_resource/p_plan_node_id/p_execution_context as non-nullable —
  // an artifact of codegen, not a real constraint the function enforces.
  // Cast once here rather than fighting the generated type field by field.
  const rpcArgs = {
    p_credential_secret: input.credentialSecret,
    p_task_id: input.taskId,
    p_tool: input.tool,
    p_operation: input.operation,
    p_resource: input.resource ?? null,
    p_arguments: input.arguments ?? {},
    p_plan_node_id: input.planNodeId ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_execution_context: input.executionContext ?? null,
    p_current_registry_version: input.currentRegistryVersion,
    p_current_compiler_version: input.currentCompilerVersion,
  } as unknown as Database["public"]["Functions"]["authorize_tool_call"]["Args"];

  const { data, error } = await supabase.rpc("authorize_tool_call", rpcArgs);

  if (error) {
    console.error(`authorize_tool_call failed (code=${error.code ?? "unknown"})`);
    throw new AuthorizeToolCallError(reasonForSqlState(error.code), error.message, { cause: error });
  }

  const row = data?.[0];
  if (!row) {
    throw new AuthorizeToolCallError("unknown", "authorize_tool_call returned no row");
  }

  return {
    decisionId: row.decision_id,
    toolRequestId: row.tool_request_id,
    outcome: row.outcome,
    reasonCodes: row.reason_codes ?? [],
    contractId: row.contract_id ?? null,
    contractVersion: row.contract_version ?? null,
    remainingInvocations: row.remaining_invocations ?? null,
    wasReplayed: row.was_replayed,
  };
}
