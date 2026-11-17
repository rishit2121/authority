import { classifyDecision, executePathFor, operationOf } from "./decision.js";
import { AuthorityApiError, AuthorityConfigError, AuthorityTimeoutError } from "./errors.js";
import { requestWithMeta, type ClientConfig, type FetchLike, type RequestOptions } from "./http.js";
import type {
  ActionAlignment,
  AgentAuthorizeResponse,
  AgentGuidance,
  ResultInspection,
  TaskSessionResponse,
  ToolManifest,
  ToolManifestEntry,
} from "./types.js";

/** Execute may wait on a provider (the server's own connector deadline is 25s); everything else keeps 15s. */
const EXECUTE_TIMEOUT_MS = 45_000;
/** `${key}:authorize` must fit the server's 200-character idempotency key limit. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 180;

/** Trusted context for one allowed action, derived from the task's contract (never from the model). */
export interface TaskActionContext {
  tool: string;
  description: string;
  /** Arguments the contract pins to exact values (`equals` constraints). The model never chooses these. */
  pinned: Readonly<Record<string, string>>;
  /** Arguments constrained by a glob (`matches`) rather than pinned to one value. */
  constrained: ReadonlyArray<{ key: string; matches: string }>;
  /**
   * The only unpinned arguments this action accepts -- the inputs a caller (or a model) supplies at run time.
   * From the contract's `openArguments`; on a contract compiled before that rule, every non-pinned key in the
   * tool's input schema.
   */
  open: readonly string[];
  /** The open arguments the plan declared as written by the agent (`agentGenerated`). */
  generated: readonly string[];
  remainingInvocations: number | null;
  maxInvocations: number | null;
  requiresApproval: boolean;
  inputSchema: Readonly<Record<string, unknown>>;
}

export interface TaskContext {
  taskId: string;
  contract: { id: string | null; version: number | null };
  manifestHash: string;
  /** One entry per allowed action; a tool allowed with two pinned sets (two recipients) appears twice. */
  actions: readonly TaskActionContext[];
}

export interface TaskCallOptions {
  /**
   * Required, chosen by you: one stable key per logical action (an event id, a message id). Repeating a call
   * with the same key never performs the action twice; a new key is a new action. There is deliberately no
   * random default.
   */
  idempotencyKey: string;
  signal?: AbortSignal;
  /** Applies to each request separately. Execute defaults to 45s, everything else to the client default. */
  timeoutMs?: number;
  /** Defaults to the action part of `tool` (e.g. "post_message"). */
  operation?: string;
  /** Optional: when omitted, Authority derives the resource from the arguments. */
  resource?: string;
}

interface CallResultBase {
  tool: string;
  idempotencyKey: string;
  /** Server request ids, for support and audit lookups. */
  requestIds: { authorize?: string; execute?: string };
  /** Present once authorize returned a decision. */
  decisionId: string | null;
  reasonCodes: string[];
  summary: string;
  guidance: AgentGuidance | null;
}

/**
 * The outcome of `AuthorityTask.call`. Every expected outcome is a value, never an exception; only a request that
 * could not be made at all (a bad credential, an unknown route) throws `AuthorityApiError`. Nothing is retried
 * automatically.
 */
export type TaskCallResult = CallResultBase &
  (
    | {
        status: "executed";
        result: string;
        receiptId: string | null;
        executionId: string | null;
        data: unknown;
        delivery?: "delivered";
        inspection?: ResultInspection;
        execution?: { mode: string; simulated: boolean };
        /** True when the server replayed an earlier execution of this key; the original data is not stored. */
        replayed: boolean;
      }
    | {
        /** The action completed but its result is withheld for review. Do not repeat it. */
        status: "result_held";
        receiptId: string | null;
        executionId: string | null;
        inspection?: ResultInspection;
        message: string;
      }
    | { status: "denied" }
    | { status: "requires_approval"; approvalId: string; statusUrl: string }
    | { status: "requires_clarification" }
    | { status: "requires_replan"; alignment?: ActionAlignment }
    /** Task alignment needs a person: once approved on the task page, repeat the call with the same key. */
    | { status: "held_for_review"; alignment: ActionAlignment }
    /**
     * This idempotency key already received its capability in an earlier call, which may have executed. Not
     * repeated. Use a new key only if you mean a second, separate action.
     */
    | { status: "already_authorized" }
    /** The execute step was refused or failed before the provider acted. Nothing was written. */
    | { status: "execution_failed"; code: string; httpStatus: number }
    /**
     * Execute was sent and its outcome is unknown: the write MAY have happened. Never retried; inspect the
     * provider (or the receipt) before deciding to act again.
     */
    | {
        status: "indeterminate";
        cause:
          | "server_reported"
          | "state_unknown"
          | "timeout"
          | "aborted"
          | "transport_error"
          | "invalid_response";
        code?: string;
        receiptId: string | null;
        executionId: string | null;
        message: string;
      }
    /** Another request with this idempotency key is executing right now. */
    | { status: "in_progress"; executionId: string | null }
    /** The session is expired, revoked or closed. Open a new task handle (`authority.openTask`). */
    | { status: "session_expired"; cause: "expired" | "closed" | "rejected" }
    /** The task's contract changed or is no longer active. Open a new handle; nothing is re-prepared for you. */
    | { status: "stale_session"; code: string }
    /** Stopped before execute was sent (your AbortSignal or a timeout). No write was attempted. */
    | {
        status: "cancelled";
        stage: "before_authorize" | "authorize" | "before_execute";
        cause: "aborted" | "timeout";
      }
  );

export type TaskCallStatus = TaskCallResult["status"];

/** How to reach this task over MCP: only for clients that can send these headers. Contains a credential. */
export interface TaskMcpConnection {
  url: string;
  headers: { Authorization: string; Accept: string };
}

/** Internal: what `Authority` hands a new handle. */
export interface AuthorityTaskInit {
  baseUrl: string;
  session: TaskSessionResponse;
  defaultTimeoutMs?: number;
  fetch?: FetchLike;
}

type ArgumentValue = unknown;

function schemaTypeOf(entry: ToolManifestEntry, key: string): string | undefined {
  const properties = (entry.inputSchema as { properties?: Record<string, { type?: unknown }> }).properties;
  const type = properties?.[key]?.type;
  return typeof type === "string" ? type : undefined;
}

/** Pins are stored as canonical text; send them back as the type the tool's schema declares. */
function coercePinned(entry: ToolManifestEntry, key: string, value: string): ArgumentValue {
  const type = schemaTypeOf(entry, key);
  if (type === "number" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

export function pinnedOf(entry: ToolManifestEntry): Record<string, string> {
  const pinned: Record<string, string> = {};
  for (const c of entry.resourceConstraints) if (typeof c.equals === "string") pinned[c.key] = c.equals;
  return pinned;
}

export function openOf(entry: ToolManifestEntry): string[] {
  if (Array.isArray(entry.openArguments)) return [...entry.openArguments];
  const pinned = new Set(entry.resourceConstraints.map((c) => c.key));
  const properties = (entry.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
  return Object.keys(properties).filter((k) => !pinned.has(k));
}

/**
 * Fill in pinned arguments the caller left out. A key the caller supplied is never rewritten, even when it
 * differs from the pin: it is sent as given and the server refuses it. When a tool is allowed with several pinned
 * sets, only the sets consistent with what the caller supplied are considered, and a key is filled in only when
 * every such set pins it to the same value -- the SDK never chooses between two recipients.
 */
export function mergePinnedArguments(
  manifest: Pick<ToolManifest, "tools">,
  tool: string,
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...args };
  const entries = manifest.tools.filter((t) => t.tool === tool);
  if (entries.length === 0) return merged;
  const supplied = (key: string) => Object.prototype.hasOwnProperty.call(args, key);
  const consistent = entries.filter((entry) =>
    Object.entries(pinnedOf(entry)).every(([key, value]) => !supplied(key) || String(args[key]) === value),
  );
  const candidates = consistent.length > 0 ? consistent : entries;
  const first = candidates[0]!;
  for (const [key, value] of Object.entries(pinnedOf(first))) {
    if (supplied(key)) continue;
    if (candidates.every((entry) => pinnedOf(entry)[key] === value)) {
      merged[key] = coercePinned(first, key, value);
    }
  }
  return merged;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * An immutable handle on ONE prepared task: its own task-session token, never shared with any other handle or
 * client and never sent to anything but this task's Authority endpoints. Opening another task never affects this
 * one. The handle is frozen; the token is held privately and is not part of `JSON.stringify(task)`.
 *
 * Create one with `authority.prepareTask(...)` (status "ready") or `authority.openTask(taskId)`.
 */
export class AuthorityTask {
  readonly taskId: string;
  readonly sessionId: string;
  /** ISO timestamp. After it, `call` returns `session_expired` without a request. */
  readonly expiresAt: string;
  readonly contract: Readonly<{ id: string; version: number }>;

  readonly #config: Readonly<ClientConfig>;
  #manifest: Promise<ToolManifest> | undefined;
  #closed = false;

  /** @internal Use `authority.prepareTask` or `authority.openTask`. */
  constructor(init: AuthorityTaskInit) {
    this.taskId = init.session.taskId;
    this.sessionId = init.session.sessionId;
    this.expiresAt = init.session.expiresAt;
    this.contract = Object.freeze({ id: init.session.contract.id, version: init.session.contract.version });
    this.#config = Object.freeze({
      baseUrl: init.baseUrl,
      token: init.session.token,
      defaultTimeoutMs: init.defaultTimeoutMs,
      fetch: init.fetch,
    });
    Object.freeze(this);
  }

  /** Never includes the session token. */
  toJSON() {
    return {
      taskId: this.taskId,
      sessionId: this.sessionId,
      expiresAt: this.expiresAt,
      contract: this.contract,
    };
  }

  isExpired(now: number = Date.now()): boolean {
    const expires = Date.parse(this.expiresAt);
    return Number.isNaN(expires) || expires <= now;
  }

  /** The contract-filtered tool manifest for this task (always fetched fresh). */
  async tools(options?: RequestOptions): Promise<ToolManifest> {
    const { body } = await requestWithMeta<ToolManifest>(
      this.#config,
      `/api/v1/tasks/${encodeURIComponent(this.taskId)}/tools`,
      { method: "GET" },
      options,
    );
    return body;
  }

  /** Trusted task context, one entry per allowed action: what is pinned, what is open, what budget is left. */
  async context(options?: RequestOptions): Promise<TaskContext> {
    const manifest = await this.tools(options);
    return {
      taskId: manifest.taskId,
      contract: manifest.contract,
      manifestHash: manifest.manifestHash,
      actions: manifest.tools.map((entry) => ({
        tool: entry.tool,
        description: entry.description,
        pinned: pinnedOf(entry),
        constrained: entry.resourceConstraints
          .filter((c) => typeof c.matches === "string")
          .map((c) => ({ key: c.key, matches: c.matches! })),
        open: openOf(entry),
        generated: [...(entry.generatedArguments ?? [])],
        remainingInvocations: entry.remainingInvocations ?? null,
        maxInvocations: entry.maxInvocations,
        requiresApproval: entry.requiresApproval,
        inputSchema: entry.inputSchema,
      })),
    };
  }

  /**
   * Authorize then (if allowed) execute one tool call. Pinned arguments from the contract are filled in for keys
   * you did not supply; a key you did supply is sent exactly as given. Returns a `TaskCallResult`; never retries.
   */
  async call(
    tool: string,
    args: Record<string, unknown> = {},
    options: TaskCallOptions,
  ): Promise<TaskCallResult> {
    const idempotencyKey = options?.idempotencyKey;
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      throw new AuthorityConfigError(
        "task.call requires options.idempotencyKey: one stable key per logical action (an event or message id).",
      );
    }
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new AuthorityConfigError(
        `idempotencyKey must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      );
    }
    if (typeof tool !== "string" || tool === "")
      throw new AuthorityConfigError("task.call requires a tool name.");

    const requestIds: CallResultBase["requestIds"] = {};
    let base: CallResultBase = {
      tool,
      idempotencyKey,
      requestIds,
      decisionId: null,
      reasonCodes: [],
      summary: "",
      guidance: null,
    };

    if (this.#closed) {
      return { ...base, summary: "This task handle was closed.", status: "session_expired", cause: "closed" };
    }
    if (this.isExpired()) {
      return {
        ...base,
        summary: "The task session has expired. Open a new task handle.",
        status: "session_expired",
        cause: "expired",
      };
    }
    if (options.signal?.aborted) {
      return {
        ...base,
        summary: "Cancelled before any request.",
        status: "cancelled",
        stage: "before_authorize",
        cause: "aborted",
      };
    }

    const requestOptions: RequestOptions = { signal: options.signal, timeoutMs: options.timeoutMs };
    const operation = operationOf(tool, options.operation);

    // 1. The pinned arguments come from the contract's own manifest, cached per handle (a handle is bound to one
    //    contract version; a changed contract is a stale session, not a new manifest).
    let manifest: ToolManifest;
    try {
      manifest = await this.#cachedManifest(requestOptions);
    } catch (error) {
      const mapped = this.#beforeExecuteFailure(error, base, "before_authorize");
      if (mapped) return mapped;
      throw error;
    }
    const callArgs = mergePinnedArguments(manifest, tool, args);

    // 2. Authorize.
    let decision: AgentAuthorizeResponse;
    try {
      const response = await requestWithMeta<AgentAuthorizeResponse>(
        this.#config,
        "/api/v1/authorize",
        {
          method: "POST",
          body: {
            taskId: this.taskId,
            tool,
            operation,
            ...(options.resource !== undefined ? { resource: options.resource } : {}),
            arguments: callArgs,
            idempotencyKey: `${idempotencyKey}:authorize`,
          },
        },
        requestOptions,
      );
      decision = response.body;
      requestIds.authorize = response.requestId;
    } catch (error) {
      if (error instanceof AuthorityApiError) requestIds.authorize = error.requestId;
      const mapped = this.#beforeExecuteFailure(error, base, "authorize");
      if (mapped) return mapped;
      throw error;
    }

    base = {
      ...base,
      decisionId: decision.decisionId || null,
      reasonCodes: decision.reasonCodes ?? [],
      summary: decision.summary ?? "",
      guidance: decision.guidance ?? null,
    };
    const outcome = classifyDecision(decision);
    switch (outcome.kind) {
      case "requires_replan":
        return outcome.alignment
          ? { ...base, status: "requires_replan", alignment: outcome.alignment }
          : { ...base, status: "requires_replan" };
      case "held_for_review":
        return { ...base, status: "held_for_review", alignment: outcome.alignment };
      case "requires_approval":
        return {
          ...base,
          status: "requires_approval",
          approvalId: outcome.approvalId,
          statusUrl: outcome.statusUrl,
        };
      case "requires_clarification":
        return { ...base, status: "requires_clarification" };
      case "already_authorized":
        return { ...base, status: "already_authorized" };
      case "denied":
        return { ...base, status: "denied" };
      case "allowed":
        break;
    }

    // 3. Last chance to stop without side effects.
    if (options.signal?.aborted) {
      return { ...base, status: "cancelled", stage: "before_execute", cause: "aborted" };
    }

    // 4. Execute. From here on, any failure to learn the outcome is "indeterminate", never retried.
    let executed: Record<string, unknown>;
    try {
      const response = await requestWithMeta<Record<string, unknown>>(
        this.#config,
        executePathFor(tool),
        {
          method: "POST",
          body: {
            capability: outcome.capabilityToken,
            tool,
            operation,
            ...(options.resource !== undefined ? { resource: options.resource } : {}),
            arguments: callArgs,
            idempotencyKey: `${idempotencyKey}:execute`,
          },
        },
        {
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? Math.max(EXECUTE_TIMEOUT_MS, this.#config.defaultTimeoutMs ?? 0),
        },
      );
      executed = response.body;
      requestIds.execute = response.requestId ?? stringOrNull(executed.requestId) ?? undefined;
    } catch (error) {
      return this.#executeFailure(error, base, requestIds);
    }
    return this.#executeSuccess(executed, base);
  }

  /** Revokes this handle's session. Later `call`s return `session_expired` without a request. */
  async close(reason?: string, options?: RequestOptions): Promise<{ result: string }> {
    this.#closed = true;
    const { body } = await requestWithMeta<{ result: string }>(
      this.#config,
      "/api/v1/sessions/revoke",
      { method: "POST", body: reason ? { reason } : {} },
      options,
    );
    return body;
  }

  /**
   * The task-bound MCP endpoint and the headers to reach it. Only for MCP clients that can send an
   * `Authorization` header; the returned value contains this task's session token, so treat it as a secret.
   */
  mcp(): TaskMcpConnection {
    return {
      url: new URL(`/api/mcp/tasks/${encodeURIComponent(this.taskId)}`, this.#config.baseUrl).toString(),
      headers: {
        Authorization: `Bearer ${this.#config.token}`,
        Accept: "application/json, text/event-stream",
      },
    };
  }

  #cachedManifest(options: RequestOptions): Promise<ToolManifest> {
    if (!this.#manifest) {
      const pending = this.tools(options);
      this.#manifest = pending;
      pending.catch(() => {
        if (this.#manifest === pending) this.#manifest = undefined;
      });
    }
    return this.#manifest;
  }

  /** Failures before execute was sent: a session problem or a cancellation. Anything else is rethrown. */
  #beforeExecuteFailure(
    error: unknown,
    base: CallResultBase,
    stage: "before_authorize" | "authorize",
  ): TaskCallResult | null {
    if (error instanceof AuthorityTimeoutError) {
      return {
        ...base,
        summary:
          stage === "authorize"
            ? "Authorize did not answer in time. No write was attempted; the authorization may have been recorded."
            : "Stopped before authorize. No write was attempted.",
        status: "cancelled",
        stage,
        cause: error.reason,
      };
    }
    if (error instanceof AuthorityApiError) {
      const session = this.#sessionFailure(error, base);
      if (session) return session;
    }
    return null;
  }

  #sessionFailure(error: AuthorityApiError, base: CallResultBase): TaskCallResult | null {
    if (error.status === 401) {
      return {
        ...base,
        summary: "The task session is expired or revoked. Open a new task handle.",
        status: "session_expired",
        cause: "rejected",
      };
    }
    if (
      error.status === 409 &&
      (error.code === "SESSION_CONTRACT_STALE" || error.code === "NO_ACTIVE_CONTRACT")
    ) {
      return {
        ...base,
        summary: "The task's contract changed or is no longer active. Open a new task handle.",
        status: "stale_session",
        code: error.code,
      };
    }
    return null;
  }

  #executeFailure(
    error: unknown,
    base: CallResultBase,
    requestIds: CallResultBase["requestIds"],
  ): TaskCallResult {
    const unknownOutcome =
      "Execute was sent but its outcome is unknown: the write may have happened. It was not retried; check the provider before acting again.";
    if (error instanceof AuthorityTimeoutError) {
      return {
        ...base,
        status: "indeterminate",
        cause: error.reason,
        receiptId: null,
        executionId: null,
        message: unknownOutcome,
      };
    }
    if (!(error instanceof AuthorityApiError)) {
      return {
        ...base,
        status: "indeterminate",
        cause: "transport_error",
        receiptId: null,
        executionId: null,
        message: unknownOutcome,
      };
    }
    requestIds.execute = error.requestId;
    const body = (error.body ?? {}) as {
      executionId?: unknown;
      receiptId?: unknown;
      error?: { code?: unknown; reason?: unknown; message?: unknown };
    };
    const executionId = stringOrNull(body.executionId);
    const receiptId = stringOrNull(body.receiptId);
    if (error.code === "INVALID_RESPONSE") {
      return {
        ...base,
        status: "indeterminate",
        cause: "invalid_response",
        receiptId,
        executionId,
        message: unknownOutcome,
      };
    }
    if (error.status === 504 || error.code === "EXECUTION_INDETERMINATE") {
      return {
        ...base,
        status: "indeterminate",
        cause: "server_reported",
        code: error.code,
        receiptId,
        executionId,
        message: stringOrNull(body.error?.message) ?? unknownOutcome,
      };
    }
    if (error.status === 409 && error.code === "EXECUTION_IN_PROGRESS") {
      return { ...base, status: "in_progress", executionId };
    }
    const session = this.#sessionFailure(error, base);
    if (session) return session;
    if (error.status === 502 || (error.status >= 400 && error.status < 500)) {
      return {
        ...base,
        status: "execution_failed",
        code: stringOrNull(body.error?.reason) ?? error.code,
        httpStatus: error.status,
      };
    }
    // 503 EXECUTION_STATE_UNKNOWN ("ran but its receipt could not be recorded") and any other 5xx.
    return {
      ...base,
      status: "indeterminate",
      cause: error.code === "EXECUTION_STATE_UNKNOWN" ? "state_unknown" : "server_reported",
      code: error.code,
      receiptId,
      executionId,
      message: unknownOutcome,
    };
  }

  #executeSuccess(executed: Record<string, unknown>, base: CallResultBase): TaskCallResult {
    const executionId = stringOrNull(executed.executionId);
    const execution =
      executed.execution && typeof executed.execution === "object"
        ? (executed.execution as { mode: string; simulated: boolean })
        : undefined;
    if (executed.replayed === true) {
      const previous = String(executed.status ?? "");
      const receipt = executed.receipt as { receiptId?: unknown; id?: unknown } | null | undefined;
      const receiptId = stringOrNull(receipt?.receiptId) ?? stringOrNull(receipt?.id);
      if (previous === "succeeded" || previous === "succeeded_noop") {
        return {
          ...base,
          status: "executed",
          result: previous,
          receiptId,
          executionId,
          data: undefined,
          ...(execution ? { execution } : {}),
          replayed: true,
        };
      }
      if (previous === "failed" || previous === "released") {
        return {
          ...base,
          status: "execution_failed",
          code: `REPLAYED_${previous.toUpperCase()}`,
          httpStatus: 200,
        };
      }
      return {
        ...base,
        status: "indeterminate",
        cause: "server_reported",
        receiptId,
        executionId,
        message: "An earlier execution of this key has an unknown outcome. It was not retried.",
      };
    }
    const receiptId = stringOrNull(executed.receiptId);
    const inspection = executed.inspection as ResultInspection | undefined;
    if (executed.delivery === "held") {
      return {
        ...base,
        status: "result_held",
        receiptId,
        executionId,
        ...(inspection ? { inspection } : {}),
        message:
          stringOrNull(executed.message) ??
          "The action completed. Its result is held for review; do not repeat the action.",
      };
    }
    return {
      ...base,
      status: "executed",
      result: String(executed.result ?? "unknown"),
      receiptId,
      executionId,
      data: executed.data,
      ...(executed.delivery === "delivered" ? { delivery: "delivered" as const } : {}),
      ...(inspection ? { inspection } : {}),
      ...(execution ? { execution } : {}),
      replayed: false,
    };
  }
}
