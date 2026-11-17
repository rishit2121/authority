/**
 * The Setup page's "Make a protected call": one real, read-only call through this deployment's own public API,
 * exactly the path a customer backend and agent take -- customer ensure, task creation with ONE connection bound,
 * prepare with a FIXED one-node plan (no model, no `generate`), a task session, authorize, execute, session revoke.
 *
 * Nothing here is retried. A timeout or a 504 after execute was sent is reported as `indeterminate` ("may have run;
 * not retried"), never re-sent. Re-running with the same `attemptId` reuses the same task and the same call key, so
 * the server refuses to dispatch it a second time.
 *
 * `fetch` is injected so the unit tests (src/tests/unit/setup/first-call.test.ts) can inspect every request, and the
 * local suite (src/tests/local/setup-first-call.test.ts) can route them to the in-process route handlers. No secret
 * is logged or returned: the keys come in, only decisions, ids and a count go out.
 */

import { summarizeReadData, type ReadCall } from "./state";

export type FirstCallOutcome =
  | "executed"
  | "blocked_before_dispatch"
  | "result_held"
  | "indeterminate"
  | "failed"
  | "needs_access"
  | "not_ready";

export interface FirstCallDecision {
  status: string;
  reasonCodes: string[];
  summary: string;
}

export interface FirstCallResult {
  taskId: string | null;
  customerId: string | null;
  decision: FirstCallDecision | null;
  receiptId: string | null;
  outcome: FirstCallOutcome;
  /** For `not_ready`: the prepare status (awaiting_approval, alignment_review, clarification, partial...). */
  preparedStatus: string | null;
  /** A count only, e.g. "12 labels". Never provider content. */
  summaryOfData: string | null;
  /** One plain sentence about what happened, safe to show. */
  detail: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface FirstCallInput {
  baseUrl: string;
  backendKey: string;
  runtimeKey: string;
  agentId: string;
  /** The setup customer's external id (`authority-setup-<userId>`). */
  externalId: string;
  call: ReadCall;
  connectionId: string;
  /** One per click on "Make a protected call"; the same id never dispatches twice. */
  attemptId: string;
  fetch: FetchLike;
  /** Per request. Defaults to 15 seconds. */
  timeoutMs?: number;
}

export const FIRST_CALL_TIMEOUT_MS = 15_000;
export const FIRST_CALL_SESSION_TTL_SECONDS = 120;

export function setupTaskKey(attemptId: string): string {
  return `setup-${attemptId}`;
}

export function setupCallKey(attemptId: string): string {
  return `setup-${attemptId}-call`;
}

/** The fixed plan: the connector's read tool, no arguments, read-only, at most once. */
export function firstCallPlan(taskId: string, call: ReadCall) {
  return {
    schemaVersion: 1 as const,
    taskId,
    nodes: [
      {
        id: "setup-read",
        sequence: 0,
        tool: call.tool,
        arguments: {},
        dependencies: [],
        declaredOutputs: [],
        dataFlowRefs: [],
        expectedSideEffect: "read" as const,
        maxInvocations: 1,
      },
    ],
  };
}

class TransportError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean,
  ) {
    super(message);
  }
}

interface ApiResponse {
  http: number;
  body: Record<string, unknown>;
}

async function post(input: FirstCallInput, path: string, token: string, body: unknown): Promise<ApiResponse> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? FIRST_CALL_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await input.fetch(`${input.baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    const parsed = (await response.json().catch(() => null)) as unknown;
    return {
      http: response.status,
      body: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
    };
  } catch (error) {
    throw new TransportError(
      timedOut
        ? `timed out after ${timeoutMs} ms`
        : error instanceof Error
          ? error.message
          : "request failed",
      timedOut,
    );
  } finally {
    clearTimeout(timer);
  }
}

function errorCode(body: Record<string, unknown>): string | null {
  const error = body.error as { code?: unknown } | undefined;
  return typeof error?.code === "string" ? error.code : null;
}

function describeFailure(step: string, response: ApiResponse): string {
  const code = errorCode(response.body);
  return `${step} was refused (HTTP ${response.http}${code ? `, ${code}` : ""}).`;
}

const NEEDS_ACCESS_CODE = "CONNECTION_NOT_USABLE_BY_CUSTOMER";

export async function runFirstCall(input: FirstCallInput): Promise<FirstCallResult> {
  const result: FirstCallResult = {
    taskId: null,
    customerId: null,
    decision: null,
    receiptId: null,
    outcome: "failed",
    preparedStatus: null,
    summaryOfData: null,
    detail: "",
  };
  const fail = (detail: string, outcome: FirstCallOutcome = "failed"): FirstCallResult => ({
    ...result,
    outcome,
    detail,
  });
  const { call } = input;

  let sessionToken: string | null = null;
  try {
    // 1. The setup customer, created (or found) by its stable external id.
    const customer = await post(input, "/api/v1/customers", input.backendKey, {
      externalId: input.externalId,
      displayLabel: "Setup test customer",
    });
    const customerId = customer.body.customerId;
    if (customer.http >= 300 || typeof customerId !== "string") {
      return fail(describeFailure("Creating the test customer", customer));
    }
    result.customerId = customerId;

    // 2. A task with exactly the one chosen connection bound.
    const task = await post(
      input,
      `/api/v1/customers/${encodeURIComponent(customerId)}/tasks`,
      input.backendKey,
      {
        agentId: input.agentId,
        intent: call.intent,
        connections: [{ connectorId: call.connectorId, connectionId: input.connectionId }],
        idempotencyKey: setupTaskKey(input.attemptId),
      },
    );
    if (errorCode(task.body) === NEEDS_ACCESS_CODE) {
      return fail(
        "Your test customer cannot use this connection yet. Nothing was sent to the provider.",
        "needs_access",
      );
    }
    const taskId = task.body.taskId;
    if (task.http >= 300 || typeof taskId !== "string") {
      return fail(describeFailure("Creating the task", task));
    }
    result.taskId = taskId;

    // 3. A fixed one-node plan. No model is involved.
    const prepared = await post(
      input,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/prepare`,
      input.backendKey,
      {
        plan: firstCallPlan(taskId, call),
        idempotencyKey: `${setupTaskKey(input.attemptId)}-prepare`,
      },
    );
    if (errorCode(prepared.body) === NEEDS_ACCESS_CODE) {
      return fail(
        "Your test customer cannot use this connection yet. Nothing was sent to the provider.",
        "needs_access",
      );
    }
    if (prepared.http >= 300) return fail(describeFailure("Preparing the task", prepared));
    const preparedStatus = typeof prepared.body.status === "string" ? prepared.body.status : "unknown";
    const tools = Array.isArray(prepared.body.tools) ? (prepared.body.tools as unknown[]) : [];
    if (preparedStatus !== "ready" || !tools.includes(call.tool)) {
      const status = preparedStatus === "ready" ? "partial" : preparedStatus;
      return {
        ...fail(`The task is not ready to run (${status}). Nothing was sent to the provider.`, "not_ready"),
        preparedStatus: status,
      };
    }

    // 4. A short task session for the agent.
    const session = await post(input, "/api/v1/sessions", input.runtimeKey, {
      taskId,
      ttlSeconds: FIRST_CALL_SESSION_TTL_SECONDS,
    });
    if (session.http >= 300 || typeof session.body.token !== "string") {
      return fail(describeFailure("Opening a task session", session));
    }
    sessionToken = session.body.token;

    // 5. Authorize. A refusal here means nothing reached the provider.
    const idempotencyKey = setupCallKey(input.attemptId);
    const request = { tool: call.tool, operation: call.operation, arguments: {}, idempotencyKey };
    const authorized = await post(input, "/api/v1/authorize", sessionToken, { taskId, ...request });
    if (authorized.http !== 200) {
      return fail(describeFailure("Authorizing the call", authorized));
    }
    result.decision = {
      status: typeof authorized.body.status === "string" ? authorized.body.status : `http_${authorized.http}`,
      reasonCodes: Array.isArray(authorized.body.reasonCodes)
        ? (authorized.body.reasonCodes as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
      summary: typeof authorized.body.summary === "string" ? authorized.body.summary : "",
    };
    const capability = authorized.body.capability as { token?: unknown; tokenAlreadyIssued?: unknown } | null;
    const capabilityToken = typeof capability?.token === "string" ? capability.token : null;
    if (!capabilityToken) {
      if (capability && capability.tokenAlreadyIssued === true) {
        return fail(
          "This attempt was already authorized earlier and may have run. It was not sent again.",
          "indeterminate",
        );
      }
      return fail(
        "Authority refused the call before anything reached the provider.",
        "blocked_before_dispatch",
      );
    }

    // 6. Execute, once. From here on, a lost response means the call MAY have run.
    let executed: ApiResponse;
    try {
      executed = await post(input, "/api/v1/execute", sessionToken, {
        capability: capabilityToken,
        ...request,
      });
    } catch (error) {
      const why = error instanceof TransportError && error.timedOut ? "timed out" : "lost its response";
      return fail(`The call ${why} after it was sent. It may have run and was not retried.`, "indeterminate");
    }
    result.receiptId = typeof executed.body.receiptId === "string" ? executed.body.receiptId : null;
    if (executed.http === 504) {
      return fail("The provider's outcome is unknown. It may have run and was not retried.", "indeterminate");
    }
    if (executed.http === 200 && executed.body.result === "succeeded") {
      const delivery = executed.body.delivery as unknown;
      const held =
        delivery === "held" ||
        (typeof delivery === "object" && delivery !== null && "status" in delivery
          ? (delivery as { status?: unknown }).status === "held"
          : false);
      if (held) {
        return fail("The call ran; its result is held for review. Do not repeat it.", "result_held");
      }
      return {
        ...result,
        outcome: "executed",
        summaryOfData: summarizeReadData(call, executed.body.data),
        detail: "Allowed and executed once. The receipt proves what ran.",
      };
    }
    return fail(describeFailure("The provider call", executed));
  } catch (error) {
    // A transport failure before execute was sent: nothing could have run.
    return fail(
      `Could not reach this deployment's API (${error instanceof Error ? error.message : "request failed"}).`,
    );
  } finally {
    if (sessionToken) {
      await post(input, "/api/v1/sessions/revoke", sessionToken, {
        reason: "setup first call finished",
      }).catch(() => undefined);
    }
  }
}
