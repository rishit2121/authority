/**
 * A dependency-free client for the Authority runtime API (Node 20+, browsers, Deno, Bun: anything with `fetch`).
 *
 *   const authority = createAuthorityClient({ baseUrl, runtimeKey });
 *   const outcome = await authority.call({ taskId, tool, operation, arguments: {...}, resource });
 *
 * `call()` asks Authority for permission, then, if it was granted, executes through Authority's connector. It returns
 * a small, explicit outcome so your agent decides what to do next instead of guessing:
 *
 *   { kind: "done", data }                      the operation ran
 *   { kind: "wait_for_approval", statusUrl }    a human must approve; poll `awaitApproval()` then call again
 *   { kind: "replan" | "clarify" | "stop", message }   follow the guidance; never retry the same refused call
 *   { kind: "retry_later", message }            a temporary condition; retry the SAME request later
 *
 * The runtime key is sent only in the Authorization header and is never logged by this file.
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
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
}) {
  if (!baseUrl || !runtimeKey) throw new Error("baseUrl and runtimeKey are required");
  const root = baseUrl.replace(/\/$/, "");

  async function request(method, path, body) {
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${runtimeKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json };
  }

  /** Step 1: ask for permission. A refusal is a normal 200 response with a status, not an exception. */
  async function authorize({ taskId, tool, operation, arguments: args, resource, idempotencyKey, maxUses }) {
    const r = await request("POST", "/api/v1/authorize", {
      taskId,
      tool,
      operation,
      arguments: args ?? {},
      ...(resource ? { resource } : {}),
      idempotencyKey,
      ...(maxUses ? { maxUses } : {}),
    });
    if (!r.ok)
      throw new AuthorityError(r.json?.error?.message ?? "authorize failed", {
        status: r.status,
        code: r.json?.error?.code,
      });
    return r.json;
  }

  /** Step 2 (GitHub tools): execute through Authority's connector. You never call GitHub, and never see its credentials. */
  async function executeGithub({ capability, tool, operation, resource, arguments: args, idempotencyKey }) {
    return request("POST", "/api/v1/github/execute", {
      capability,
      tool,
      operation,
      resource,
      arguments: args ?? {},
      idempotencyKey,
    });
  }

  async function approvalStatus(statusUrl) {
    const path = statusUrl.startsWith("http") ? new URL(statusUrl).pathname : statusUrl;
    return (await request("GET", path)).json;
  }

  async function awaitApproval(statusUrl, { intervalMs = 3000, maxWaitMs = 10 * 60_000 } = {}) {
    const end = Date.now() + maxWaitMs;
    for (;;) {
      const s = await approvalStatus(statusUrl);
      if (s.state && s.state !== "pending") return s;
      if (Date.now() > end) return { state: "pending", timedOut: true };
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function call(input) {
    const idempotencyKey = input.idempotencyKey ?? `${input.taskId.slice(0, 8)}-${input.tool}-${Date.now()}`;
    const decision = await authorize({ ...input, idempotencyKey });
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

    if (!input.tool.startsWith("github.")) {
      // Tools without an Authority connector are executed by your own code with the capability as proof of permission.
      return { kind: "authorized", capability: decision.capability, message, decision };
    }
    const exec = await executeGithub({
      capability: decision.capability.token,
      tool: input.tool,
      operation: input.operation,
      resource: input.resource,
      arguments: input.arguments,
      idempotencyKey,
    });
    if (exec.ok) return { kind: "done", data: exec.json.data, receiptId: exec.json.receiptId, decision };
    const code = exec.json?.error?.code ?? "EXECUTION_FAILED";
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

  return { authorize, executeGithub, approvalStatus, awaitApproval, call };
}
