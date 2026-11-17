import { contentApi, type ContentApi } from "./content.js";
import { classifyDecision, executePathFor, operationOf } from "./decision.js";
import { request, type ClientConfig, type FetchLike, type RequestOptions } from "./http.js";
import type {
  AgentAuthorizeResponse,
  ApprovalStatus,
  ResultInspection,
  TaskSessionResponse,
  ToolCallResult,
  ToolManifest,
} from "./types.js";

export interface AuthorityAgentClientOptions {
  baseUrl: string;
  /** An agent runtime key (`authority_rk_...`) or an existing task-session token. `sessions.create` upgrades this client to the session token it returns. */
  token: string;
  defaultTimeoutMs?: number;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * The agent-runtime side of the Authority developer API: list the tools a
 * task's active contract permits, call one through the mandatory authorize
 * -> capability -> execute sequence, and close the session when done.
 *
 * Tool-list filtering (`tools.list`) is a convenience and an exposure
 * reduction, never a grant: `tools.execute` independently re-authorizes
 * every call against the real, current contract regardless of what a
 * (possibly stale) manifest showed. This client never retries an
 * indeterminate write automatically -- see `tools.execute`'s own comment.
 *
 * Stateful by design (kept for compatibility): `sessions.create` replaces
 * this instance's credential with the session token it returns, one-way.
 * The server refuses to create a session from a session token, so one
 * instance can only ever hold ONE task session; create a new instance per
 * task. The `Authority` facade (`authority.ts`) never mutates a shared
 * credential -- each `AuthorityTask` holds its own token -- and is the
 * recommended entry point.
 */
export class AuthorityAgentClient {
  private readonly config: ClientConfig;

  /**
   * Inspect external content for this agent's task before the model sees it. Use a task session:
   * when alignment is enforced, a raw runtime key is refused because it is not bound to one task.
   */
  content: ContentApi = contentApi(() => this.config);

  constructor(options: AuthorityAgentClientOptions) {
    this.config = {
      baseUrl: options.baseUrl,
      token: options.token,
      defaultTimeoutMs: options.defaultTimeoutMs,
      fetch: options.fetch,
    };
  }

  sessions = {
    /**
     * Exchanges the runtime key this client was constructed with for a
     * short-lived, task-scoped session token, and upgrades this client
     * instance to present that token on every subsequent call -- the
     * runtime key itself is never sent again after this succeeds.
     */
    create: async (input: { taskId: string; ttlSeconds?: number }, options?: RequestOptions) => {
      const result = await request<TaskSessionResponse>(
        this.config,
        "/api/v1/sessions",
        { method: "POST", body: input },
        options,
      );
      this.config.token = result.token;
      return result;
    },

    /** Revokes the session token this client currently holds. Requires `sessions.create` to have been called first. */
    close: (reason?: string, options?: RequestOptions) =>
      request<{ result: string }>(
        this.config,
        "/api/v1/sessions/revoke",
        { method: "POST", body: reason ? { reason } : {} },
        options,
      ),
  };

  tools = {
    /** The contract-filtered tool manifest for this task -- every operation its currently active contract allows. */
    list: (taskId: string, options?: RequestOptions) =>
      request<ToolManifest>(this.config, `/api/v1/tasks/${taskId}/tools`, { method: "GET" }, options),

    /**
     * Authorize then (if allowed) execute one tool call, in one round trip
     * from the caller's point of view. Returns a typed outcome rather than
     * throwing for "denied" / "requires_approval" / "requires_clarification"
     * / "requires_replan" -- those are ordinary decisions the deterministic
     * pipeline made, not failures of this call.
     *
     * Never retries automatically: if the execute step's own outcome is
     * "indeterminate" (the provider call may or may not have taken effect),
     * that is returned verbatim in `result` for the caller to decide what to
     * do -- silently retrying an indeterminate write could duplicate a real
     * side effect.
     */
    execute: async (
      input: {
        taskId: string;
        tool: string;
        /** Defaults to the action part of `tool` (e.g. "list_channels"). */
        operation?: string;
        /** Optional: when omitted, Authority derives it from `arguments` using the tool's own connector. */
        resource?: string;
        arguments?: Record<string, unknown>;
        idempotencyKey?: string;
        maxUses?: number;
      },
      options?: RequestOptions,
    ): Promise<ToolCallResult> => {
      const key = input.idempotencyKey ?? `${input.taskId}-${input.tool}-${randomSuffix()}`;
      const operation = operationOf(input.tool, input.operation);
      const args = input.arguments ?? {};
      const decision = await this.authorize(
        {
          taskId: input.taskId,
          tool: input.tool,
          operation,
          resource: input.resource,
          arguments: args,
          idempotencyKey: `${key}:authorize`,
          maxUses: input.maxUses,
        },
        options,
      );

      const { reasonCodes, summary } = decision;
      const outcome = classifyDecision(decision);
      switch (outcome.kind) {
        case "requires_replan":
          return outcome.alignment
            ? { status: "requires_replan", reasonCodes, summary, alignment: outcome.alignment }
            : { status: "requires_replan", reasonCodes, summary };
        case "held_for_review":
          return { status: "held_for_review", reasonCodes, summary, alignment: outcome.alignment };
        case "requires_approval":
          return {
            status: "requires_approval",
            approvalId: outcome.approvalId,
            statusUrl: outcome.statusUrl,
          };
        case "requires_clarification":
          return { status: "requires_clarification", reasonCodes, summary };
        // This client has always reported a capability it cannot spend (including one already issued) as denied.
        case "already_authorized":
        case "denied":
          return { status: "denied", reasonCodes, summary };
        case "allowed":
          break;
      }

      const executed = await this.executeCapability(
        {
          capability: outcome.capabilityToken,
          tool: input.tool,
          operation,
          resource: input.resource,
          arguments: args,
          idempotencyKey: `${key}:execute`,
        },
        options,
      );
      return {
        status: "executed",
        result: String(executed.result ?? "unknown"),
        data: executed.data,
        receiptId: typeof executed.receiptId === "string" ? executed.receiptId : undefined,
        ...(executed.delivery === "held" || executed.delivery === "delivered"
          ? { delivery: executed.delivery }
          : {}),
        ...(executed.inspection ? { inspection: executed.inspection as ResultInspection } : {}),
      };
    },
  };

  approvals = {
    get: (approvalId: string, options?: RequestOptions) =>
      request<ApprovalStatus>(this.config, `/api/v1/approvals/${approvalId}`, { method: "GET" }, options),
  };

  /** Low-level: authorize one tool call without executing it. Exposed for callers that manage the capability token themselves. */
  authorize(
    input: {
      taskId: string;
      tool: string;
      operation: string;
      resource?: string;
      arguments: Record<string, unknown>;
      idempotencyKey: string;
      maxUses?: number;
    },
    options?: RequestOptions,
  ) {
    return request<AgentAuthorizeResponse>(
      this.config,
      "/api/v1/authorize",
      { method: "POST", body: input },
      options,
    );
  }

  /**
   * Low-level: spend a capability already issued by `authorize`. Exposed
   * for callers that manage the capability token themselves.
   *
   * `github.*` tools still run through their own dedicated route
   * (`/api/v1/github/execute`) rather than the generic connector route --
   * GitHub has not been migrated onto the shared connector executor (see
   * `src/lib/connectors/register.ts`'s own comment on why), so this is the
   * one place the SDK's otherwise-uniform agent surface has to know that.
   * Same request/response shape either way; callers never need to branch
   * on this themselves.
   */
  executeCapability(
    input: {
      capability: string;
      tool: string;
      operation: string;
      /** Optional: when omitted, Authority derives it from `arguments` using the tool's own connector. */
      resource?: string;
      arguments: Record<string, unknown>;
      idempotencyKey: string;
    },
    options?: RequestOptions,
  ) {
    return request<Record<string, unknown>>(
      this.config,
      executePathFor(input.tool),
      { method: "POST", body: input },
      options,
    );
  }
}
