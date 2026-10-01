import "server-only";

import { failureContract } from "@/lib/gateway/response";
import {
  finishConnectorExecution,
  markConnectorDispatched,
  reserveConnectorExecution,
  type ConnectorResultCategory,
  type FinishConnectorInput,
  type ReserveConnectorResult,
} from "@/lib/gateway/rpc-connectors";
import { safeLog } from "@/lib/semantic/scrub";

import { ensureConnectorsRegistered } from "./register";
import { resolveConnectorForTool } from "./registry";
import type { ConnectorExecutionResult } from "./types";

export interface ExecuteConnectorInput {
  credentialSecret: string;
  tokenHash: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ExecuteConnectorResult {
  http: number;
  body: Record<string, unknown>;
}

/** Dependency-injection seam, mirroring src/lib/github/executor.ts's ExecutorDeps — lets tests exercise the full orchestration without touching the database or a real provider. */
export interface ConnectorExecutorDeps {
  resolveConnector: typeof resolveConnectorForTool;
  reserve: typeof reserveConnectorExecution;
  dispatch: typeof markConnectorDispatched;
  finish: typeof finishConnectorExecution;
  executionMode: () => "mock" | "live";
  deadlineMs: number;
}

export const defaultConnectorExecutorDeps: ConnectorExecutorDeps = {
  resolveConnector: resolveConnectorForTool,
  reserve: reserveConnectorExecution,
  dispatch: markConnectorDispatched,
  finish: finishConnectorExecution,
  executionMode: () => (process.env.NODE_ENV === "production" ? "live" : "mock"),
  deadlineMs: 25_000,
};

const LEASE_SECONDS = 45;

const REJECTION_HTTP: Record<string, number> = {
  CAPABILITY_NOT_FOUND: 404,
  SCOPE_MISMATCH: 403,
  CONNECTOR_NOT_CONFIGURED: 503,
  CONNECTION_UNAVAILABLE: 403,
  EXECUTION_MODE_MISMATCH: 409,
};

const label = (mode: "mock" | "live") => ({ mode, simulated: mode === "mock" });

/**
 * The generic counterpart to `executeGithubOperation`
 * (src/lib/github/executor.ts): reserve (atomic) -> pre-dispatch validation
 * -> re-check revocation + mark dispatched -> the connector's own provider
 * call -> settle (consumed / failed / indeterminate) with an immutable
 * receipt. Same failure semantics: a failure before dispatch releases the
 * reservation (use refunded); once a request may have left, a failure is
 * `failed` (definite refusal) or `indeterminate` (outcome unknown) and is
 * never retried automatically.
 *
 * Dispatches to whichever `AuthorityConnector` the tool's provider prefix
 * resolves to (`resolveConnectorForTool`) — this is the one place GitHub and
 * every other connector could eventually share a call site, though GitHub's
 * own route (`/api/v1/github/execute`) still calls `executeGithubOperation`
 * directly today (see Phase 4 of the agent-integration roadmap).
 */
export async function executeConnectorOperation(
  input: ExecuteConnectorInput,
  deps: ConnectorExecutorDeps = defaultConnectorExecutorDeps,
): Promise<ExecuteConnectorResult> {
  if (deps.resolveConnector === resolveConnectorForTool) ensureConnectorsRegistered();
  const connector = deps.resolveConnector(input.tool);
  if (!connector) {
    return {
      http: 501,
      body: {
        error: { code: "OPERATION_NOT_SUPPORTED", message: "This tool has no implemented connector." },
      },
    };
  }

  const executionMode = deps.executionMode();

  const reserved: ReserveConnectorResult = await deps.reserve({
    credentialSecret: input.credentialSecret,
    tokenHash: input.tokenHash,
    tool: input.tool,
    operation: input.operation,
    resource: input.resource,
    args: input.args,
    idempotencyKey: input.idempotencyKey,
    executionMode,
    leaseSeconds: LEASE_SECONDS,
  });

  if (reserved.status !== "ok") {
    const c = failureContract(reserved.status);
    return { http: c.http, body: { error: { code: c.code, message: c.message } } };
  }
  if (reserved.result === "in_progress") {
    return {
      http: 409,
      body: {
        error: { code: "EXECUTION_IN_PROGRESS", message: "This execution is already in progress." },
        executionId: reserved.executionId,
      },
    };
  }
  if (reserved.result === "replayed") {
    return {
      http: 200,
      body: {
        replayed: true,
        executionId: reserved.executionId,
        status: reserved.previousStatus,
        execution: label(executionMode),
        receipt: reserved.previousReceipt,
        note: "The original result body is not stored; request a new capability to re-read.",
      },
    };
  }
  if (
    reserved.result !== "reserved" ||
    !reserved.executionId ||
    !reserved.agentId ||
    !reserved.taskId ||
    !reserved.connectionId ||
    !reserved.connectorId
  ) {
    const code = reserved.reasonCode ?? "CAPABILITY_REJECTED";
    return {
      http: REJECTION_HTTP[code] ?? 409,
      body: { error: { code, message: "The capability could not be used." } },
    };
  }

  const executionId = reserved.executionId;
  const agentId = reserved.agentId;
  const startedAt = new Date();
  const settle = async (
    category: ConnectorResultCategory,
    reasonCode: string | null,
    extra: Partial<FinishConnectorInput> = {},
  ): Promise<{ receiptId: string | null; finalStatus: string | null } | null> => {
    try {
      const r = await deps.finish({
        executionId,
        agentId,
        category,
        reasonCode,
        providerRequestId: null,
        httpStatusClass: null,
        resourceIds: {},
        startedAt,
        redaction: {},
        ...extra,
      });
      return { receiptId: r.receiptId, finalStatus: r.finalStatus };
    } catch {
      safeLog("connector executor: could not settle reservation (lease reconciliation will conclude it)");
      return null;
    }
  };
  const released = async (code: string, http: number): Promise<ExecuteConnectorResult> => {
    const s = await settle("released", code);
    return {
      http,
      body: {
        error: { code, message: "The request was not dispatched." },
        executionId,
        status: "released",
        receiptId: s?.receiptId ?? null,
        execution: label(executionMode),
      },
    };
  };

  // ---- pre-dispatch validation: a definite failure here releases the use ----
  let normalized;
  try {
    normalized = await connector.normalizeRequest(input.tool, input.args);
    if (reserved.connectorId && !normalized.tool.startsWith(`${reserved.connectorId}.`)) {
      return released("OPERATION_CONNECTOR_MISMATCH", 422);
    }
    if (input.resource && normalized.resource !== input.resource) {
      return released("RESOURCE_MISMATCH", 403);
    }
  } catch {
    return released("ARGUMENTS_INVALID", 400);
  }

  // ---- last look at revocation, then the point of no return ----
  const dispatch = await deps.dispatch({ executionId, agentId });
  if (dispatch.status !== "ok") {
    const code = dispatch.reason ?? dispatch.status.toUpperCase();
    return {
      http: dispatch.status === "blocked" ? 403 : 409,
      body: {
        error: { code, message: "The execution could not be dispatched." },
        executionId,
        execution: label(executionMode),
      },
    };
  }

  const controller = new AbortController();
  let writeStarted = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("DEADLINE_EXCEEDED"));
    }, deps.deadlineMs);
  });
  deadline.catch(() => undefined);

  let outcome: ConnectorExecutionResult | null = null;
  let failure: { category: ConnectorResultCategory; code: string; http: number } | null = null;
  try {
    outcome = await Promise.race([
      deadline,
      connector.execute(normalized, {
        connectionId: reserved.connectionId,
        taskId: reserved.taskId,
        agentId,
        idempotencyKey: input.idempotencyKey,
        signal: controller.signal,
        beforeWrite: () => {
          writeStarted = true;
        },
      }),
    ]);
  } catch (error) {
    const category: ConnectorResultCategory = writeStarted ? "indeterminate" : "failed";
    const code = timedOut
      ? "DEADLINE_EXCEEDED"
      : error instanceof Error
        ? error.message || "INTERNAL_ERROR"
        : "INTERNAL_ERROR";
    // Indeterminate is always 504, matching docs/api/OPENAPI.yaml's ExecuteIndeterminate
    // response regardless of what the connector's own error happened to say.
    failure = { category, code, http: category === "indeterminate" ? 504 : 502 };
  } finally {
    clearTimeout(timer);
  }

  if (failure) {
    const s = await settle(failure.category, failure.code);
    const indeterminate = failure.category === "indeterminate";
    return {
      http: failure.http,
      body: {
        error: {
          code: indeterminate ? "EXECUTION_INDETERMINATE" : failure.code,
          reason: failure.code,
          message: indeterminate
            ? "The outcome of this write is unknown. It has NOT been retried; inspect the provider before requesting again."
            : "The connector refused or could not complete the request.",
        },
        executionId,
        status: failure.category,
        receiptId: s?.receiptId ?? null,
        execution: label(executionMode),
      },
    };
  }

  const result = outcome!;
  const settled = await settle(result.category, null, {
    providerRequestId: result.providerRequestId,
    httpStatusClass: result.httpStatusClass,
    resourceIds: JSON.parse(JSON.stringify(result.resourceIds)) as Record<string, unknown>,
    redaction: { counts: result.redaction },
  });
  if (!settled) {
    return {
      http: 503,
      body: {
        error: {
          code: "EXECUTION_STATE_UNKNOWN",
          message: "The operation ran but its receipt could not be recorded; do not retry.",
        },
        executionId,
        execution: label(executionMode),
      },
    };
  }
  return {
    http: 200,
    body: {
      result: result.category,
      executionId,
      receiptId: settled.receiptId,
      execution: label(executionMode),
      resource: result.resourceIds,
      data: result.agentPayload,
    },
  };
}
