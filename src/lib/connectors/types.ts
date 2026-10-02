import "server-only";

import type { ToolOperation } from "@/lib/registry/types";

/**
 * The generic connector interface, extracted from the GitHub connector's
 * proven shape (`src/lib/github/operations.ts` + `executor.ts`) without
 * changing GitHub's own behavior — see Phase 4 of the agent-integration
 * roadmap for GitHub's own move onto this interface. New connectors
 * (Custom API, Stripe, Gmail, Slack, PostgreSQL) implement this directly.
 *
 * What stays the same for every connector, regardless of provider:
 *
 *   describeOperations -> registered, trusted, audited tool definitions
 *   verifyInstallation -> is this tenant's connection to the provider healthy
 *   normalizeRequest   -> turn an agent's {operation, input} into one exact,
 *                         server-validated request — never a URL/method/path
 *                         the agent supplied
 *   execute            -> reserve -> dispatch -> provider call -> settle,
 *                         through the SAME two-phase lifecycle GitHub uses
 *   reconcile          -> resolve an execution whose outcome was left
 *                         unknown by a timeout or crash after dispatch
 *
 * Agents never see any of this directly. They present a capability (minted
 * by `/authorize`) to `POST /execute`; the route resolves the tool's
 * provider prefix to a connector instance and calls these methods. Nothing
 * here accepts an arbitrary URL, HTTP method, header, provider token,
 * tenant id, credential selector, or executable code from the agent.
 */

/** Mirrors `gateway.*`'s settlement categories — see 20260930000003_two_phase_capabilities.sql. */
export type ConnectorResultCategory =
  "succeeded" | "succeeded_noop" | "failed" | "indeterminate" | "released";

/** The subset of ConnectorResultCategory a successful `execute()` may return. */
export type ConnectorSuccessCategory = Extract<ConnectorResultCategory, "succeeded" | "succeeded_noop">;

export interface ConnectorHealthResult {
  status: "active" | "suspended" | "permission_drift" | "disconnected" | "not_configured";
  /** Machine-readable reason codes, e.g. "PERMISSION_MISSING:contents" — never prose with secrets in it. */
  reasons: string[];
  lastVerifiedAt: string | null;
}

/**
 * The exact, fully-resolved request a connector is about to run — built
 * entirely server-side by `normalizeRequest()` from the operation's own
 * declarative definition and the agent's validated arguments. This is what
 * a capability's constraints bind against, never a client-supplied request.
 */
export interface NormalizedConnectorRequest {
  tool: string;
  operation: string;
  resource: string;
  args: Record<string, unknown>;
}

export interface ConnectorContext {
  /**
   * Which of the tenant's configured connections/installations for this
   * connector to use. `connector_connections.id` is a globally unique
   * primary key, so this alone is enough to look up the connection's own
   * config/credentials (and, from that same row, its tenant id for
   * verification) — callers that already have a tenant id in hand from
   * their own session (e.g. a connection-setup UI action) are free to use
   * it for an extra authorization check before calling in, but it is not
   * part of this shared interface since the reserve/execute path that calls
   * `execute()` doesn't learn the tenant id until the capability itself is
   * resolved server-side, exactly like GitHub's own `ExecutionContext`.
   */
  connectionId: string;
}

export interface ConnectorExecutionContext extends ConnectorContext {
  taskId: string;
  agentId: string;
  idempotencyKey: string;
  signal: AbortSignal;
  /**
   * Call immediately before the first byte of a mutating provider request is
   * sent. Mirrors GitHub's `ExecutionContext.beforeWrite` exactly: a
   * timeout/crash after this point settles as `indeterminate`, never
   * `failed` — the write may have already happened and must never be
   * silently retried.
   */
  beforeWrite: () => void;
}

export interface ConnectorExecutionResult {
  category: ConnectorSuccessCategory;
  /** Identifiers only (ids, not full objects) — capped, like GitHub's `resourceIds`. */
  resourceIds: Record<string, unknown>;
  providerRequestId: string | null;
  httpStatusClass: number | null;
  /** Redacted, size-bounded, connector-defined projection — this is what the agent actually receives. */
  agentPayload: Record<string, unknown>;
  /** Count of fields redacted, by reason — never the redacted values themselves. */
  redaction: Record<string, number>;
}

/** An execution whose settlement was never recorded — lease-expired after dispatch, or a crash mid-call. */
export interface IndeterminateExecution {
  executionId: string;
  connectorId: string;
  tool: string;
  operation: string;
  resource: string;
  context: ConnectorContext;
  dispatchedAt: string;
}

export interface ReconciliationResult {
  outcome: "confirmed_succeeded" | "confirmed_failed" | "still_unknown";
  /** Machine-readable detail for the receipt, e.g. a provider request id found on re-query. */
  detail: string;
}

export interface AuthorityConnector {
  /**
   * Matches the tool-name provider prefix this connector owns, e.g. "github",
   * "stripe". `toolNameSchema` (src/lib/domain/common.ts) only allows exactly
   * one dot (`provider.action`), so a tenant's Custom API connection gets its
   * own opaque provider id assigned at connection-creation time (e.g.
   * "custom_a1b2c3d4"), never a literal "custom.<connectionId>.<action>" —
   * that would need three segments and a schema change this roadmap avoids.
   */
  readonly id: string;

  /** The trusted, audited operations this connector exposes — merged into the registry, never tenant-writable at this layer. */
  describeOperations(): ToolOperation[];

  /** Whether this tenant's connection/installation is currently usable. Called before every reservation. */
  verifyInstallation(context: ConnectorContext): Promise<ConnectorHealthResult>;

  /**
   * Builds the exact request the connector will run from the full, trusted
   * tool id (e.g. "github.get_issue", "custom_<connectionId>.get_order") and
   * the agent's raw, schema-validated input. Looked up by `tool`, not the
   * separate free-form `operation` scope-check field also carried on a
   * capability -- matching GitHub's own OPERATIONS.get(input.tool), and the
   * only option that carries enough information for a connector whose
   * operations are not statically, globally keyed (Custom API's single
   * shared connector instance serves every tenant's every connection; a bare
   * action slug alone cannot say which one). Throws a definite rejection
   * (never silently coerces) if the input doesn't match the operation's own
   * strict schema.
   *
   * Async because a connector whose operations are tenant-published (Custom
   * API) must resolve the operation's own definition row (pinned by id,
   * immutable once published) before it can validate anything — there is no
   * way to do that from process memory alone, unlike GitHub's static
   * registry. A statically-registered connector (GitHub once migrated,
   * Stripe, Slack) can simply resolve to an already-settled value.
   */
  normalizeRequest(tool: string, input: unknown): Promise<NormalizedConnectorRequest>;

  /** Runs one already-reserved, already-dispatched request. Never called directly by a route handler — only by the generic executor. */
  execute(
    request: NormalizedConnectorRequest,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorExecutionResult>;

  /** Resolves an indeterminate execution by re-querying the provider, where the provider supports a safe, idempotent lookup. */
  reconcile(execution: IndeterminateExecution): Promise<ReconciliationResult>;
}
