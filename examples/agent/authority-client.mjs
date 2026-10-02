/**
 * A dependency-free client for the Authority runtime API (Node 20+, browsers, Deno, Bun: anything with `fetch`).
 *
 * Two ways to authenticate, both accepted everywhere a credential is sent (Authorization: Bearer ...):
 *
 *   const authority = createAuthorityClient({ baseUrl, runtimeKey });          // works on every call, any task
 *   const { token } = await authority.createSession({ taskId });
 *   const scoped = createAuthorityClient({ baseUrl, sessionToken: token });    // one task, up to 15 minutes
 *
 * A session is a convenience, not a separate trust model: it is resolved through the exact same check a runtime
 * key is, just scoped to one task and shorter-lived. Prefer it when your process already knows which task it's
 * working on for a while, so the long-lived runtime key never has to leave wherever you keep it.
 *
 *   const outcome = await authority.call({ taskId, tool, operation, arguments: {...}, resource });
 *
 * `call()` asks Authority for permission, then, if it was granted, executes through Authority's own connector
 * (GitHub tools go through `/api/v1/github/execute`; every other registered connector -- Stripe, Gmail, Slack,
 * PostgreSQL, Custom API -- goes through the generic `/api/v1/execute`). It returns a small, explicit outcome so
 * your agent decides what to do next instead of guessing:
 *
 *   { kind: "done", data }                      the operation really ran; `data` is the connector's own payload
 *   { kind: "wait_for_approval", statusUrl }    a human must approve; poll `awaitApproval()` then call again
 *   { kind: "replan" | "clarify" | "stop", message }   follow the guidance; never retry the same refused call
 *   { kind: "retry_later", message }            a temporary condition; retry the SAME request later
 *   { kind: "authorized", capability }          permission was granted for a tool with no Authority connector
 *                                                (OPERATION_NOT_SUPPORTED) -- your own code executes it, using
 *                                                the capability only as proof of permission, never a bypass
 *
 * Whichever credential you hold is sent only in the Authorization header and is never logged by this file.
 */

const NEXT_STEPS = new Set(["proceed", "replan", "clarify", "request_approval", "retry_later", "stop"]);

export class AuthorityError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "AuthorityError";
    this.status = status;
    this.code = code;
  }
}

export function createAuthorityClient({
  baseUrl,
  runtimeKey,
  sessionToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
}) {
  const credential = runtimeKey ?? sessionToken;
  if (!baseUrl || !credential) throw new Error("baseUrl and either runtimeKey or sessionToken are required");
  const root = baseUrl.replace(/\/$/, "");

  async function request(method, path, body, { signal } = {}) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json };
  }

  /** Exchanges the runtime key for a short-lived, task-scoped session. Requires the task to have an active contract. */
  async function createSession({ taskId, ttlSeconds }, options) {
    const r = await request(
      "POST",
      "/api/v1/sessions",
      { taskId, ...(ttlSeconds ? { ttlSeconds } : {}) },
      options,
    );
    if (!r.ok)
      throw new AuthorityError(r.json?.error?.message ?? "session creation failed", {
        status: r.status,
        code: r.json?.error?.code,
      });
    return r.json;
  }

  /** Introspects whichever session token this client holds. Throws if this client was built with a runtime key instead. */
  async function currentSession(options) {
    return (await request("GET", "/api/v1/sessions/current", undefined, options)).json;
  }

  /** Ends the session this client holds early. A no-op error if this client was built with a runtime key. */
  async function revokeSession({ reason } = {}, options) {
    return (await request("POST", "/api/v1/sessions/revoke", reason ? { reason } : {}, options)).json;
  }

  /** The exact set of tools this task's active contract currently allows -- convenience, not authority; see module comment. */
  async function fetchTools(taskId, options) {
    const r = await request("GET", `/api/v1/tasks/${taskId}/tools`, undefined, options);
    if (!r.ok)
      throw new AuthorityError(r.json?.error?.message ?? "fetching the tool manifest failed", {
        status: r.status,
        code: r.json?.error?.code,
      });
    return r.json;
  }

  /** Step 1: ask for permission. A refusal is a normal 200 response with a status, not an exception. */
  async function authorize(
    { taskId, tool, operation, arguments: args, resource, idempotencyKey, maxUses },
    options,
  ) {
    const r = await request(
      "POST",
      "/api/v1/authorize",
      {
        taskId,
        tool,
        operation,
        arguments: args ?? {},
        ...(resource ? { resource } : {}),
        idempotencyKey,
        ...(maxUses ? { maxUses } : {}),
      },
      options,
    );
    if (!r.ok)
      throw new AuthorityError(r.json?.error?.message ?? "authorize failed", {
        status: r.status,
        code: r.json?.error?.code,
      });
    return r.json;
  }

  /** Executes any connector-backed tool (Stripe, Gmail, Slack, PostgreSQL, Custom API, ...) except GitHub's. */
  async function execute(
    { capability, tool, operation, resource, arguments: args, idempotencyKey },
    options,
  ) {
    return request(
      "POST",
      "/api/v1/execute",
      { capability, tool, operation, resource, arguments: args ?? {}, idempotencyKey },
      options,
    );
  }

  /** GitHub keeps its own dedicated execution route and executor; every other tool uses execute() above. */
  async function executeGithub(
    { capability, tool, operation, resource, arguments: args, idempotencyKey },
    options,
  ) {
    return request(
      "POST",
      "/api/v1/github/execute",
      { capability, tool, operation, resource, arguments: args ?? {}, idempotencyKey },
      options,
    );
  }

  async function approvalStatus(statusUrl) {
    const path = statusUrl.startsWith("http") ? new URL(statusUrl).pathname : statusUrl;
    return (await request("GET", path)).json;
  }

  /** Never resolves to a guess: times out to `{state: "pending", timedOut: true}` rather than assuming success. */
  async function awaitApproval(statusUrl, { intervalMs = 3000, maxWaitMs = 10 * 60_000, signal } = {}) {
    const end = Date.now() + maxWaitMs;
    for (;;) {
      const s = await approvalStatus(statusUrl);
      if (s.state && s.state !== "pending") return s;
      if (Date.now() > end) return { state: "pending", timedOut: true };
      if (signal?.aborted) return { state: "pending", aborted: true };
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /** Classifies one dispatch response into this module's outcome vocabulary. Shared by both execution routes. */
  function outcomeFromExecution(exec, decision) {
    if (exec.ok) {
      if (exec.json.replayed) {
        return {
          kind: "done",
          data: undefined,
          replayed: true,
          message:
            "This idempotency key already ran; the original response body is not stored. Request a new capability to re-read.",
          receiptId: exec.json.receiptId,
          decision,
        };
      }
      return { kind: "done", data: exec.json.data, receiptId: exec.json.receiptId, decision };
    }
    const code = exec.json?.error?.code ?? "EXECUTION_FAILED";
    // Permission was granted, but the connector itself doesn't exist for this tool -- not a refusal, and not
    // something to retry; this is the one case where your own code (not Authority's) must execute the call.
    if (code === "OPERATION_NOT_SUPPORTED") {
      return {
        kind: "authorized",
        capability: decision.capability,
        message: "No Authority connector for this tool.",
        decision,
      };
    }
    // The write may or may not have happened server-side; never retry it automatically.
    if (exec.status === 504 || code === "EXECUTION_INDETERMINATE")
      return {
        kind: "stop",
        message: "The outcome of this write is unknown. Do not retry it; ask a human to check.",
        code,
        decision,
      };
    return {
      kind: exec.json?.status === "released" ? "retry_later" : "stop",
      message: `Execution refused: ${code}`,
      code,
      decision,
    };
  }

  /**
   * Authorizes one proposed call and, if allowed, executes it -- never both in one irrevocable step the caller
   * can't inspect first. `idempotencyKey` defaults to a stable value derived from the inputs so an accidental
   * duplicate `call()` (e.g. a retry after a dropped connection) replays instead of double-executing; pass your
   * own for an idempotency key that survives process restarts.
   */
  async function call(input, { signal } = {}) {
    const idempotencyKey = input.idempotencyKey ?? `${input.taskId.slice(0, 8)}-${input.tool}-${Date.now()}`;
    const decision = await authorize({ ...input, idempotencyKey }, { signal });
    const nextStep = NEXT_STEPS.has(decision.guidance?.nextStep) ? decision.guidance.nextStep : "stop";
    const message = decision.guidance?.message ?? decision.summary ?? "";

    if (nextStep === "request_approval")
      return {
        kind: "wait_for_approval",
        statusUrl: decision.approval?.statusUrl ?? null,
        message,
        decision,
        idempotencyKey,
      };
    if (nextStep !== "proceed" || !decision.capability?.token)
      return { kind: nextStep === "proceed" ? "stop" : nextStep, message, decision };

    const dispatch = input.tool.startsWith("github.") ? executeGithub : execute;
    const exec = await dispatch(
      {
        capability: decision.capability.token,
        tool: input.tool,
        operation: input.operation,
        resource: input.resource,
        arguments: input.arguments,
        idempotencyKey,
      },
      { signal },
    );
    return outcomeFromExecution(exec, decision);
  }

  return {
    authorize,
    execute,
    executeGithub,
    approvalStatus,
    awaitApproval,
    call,
    createSession,
    currentSession,
    revokeSession,
    fetchTools,
  };
}
