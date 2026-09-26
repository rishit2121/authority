import "server-only";

import { ZodError } from "zod";

import { failureContract } from "@/lib/gateway/response";
import {
  finishExecution,
  markDispatched,
  reserveExecution,
  type FinishInput,
  type ReserveResult,
  type ResultCategory,
} from "@/lib/gateway/rpc-github";
import { safeLog } from "@/lib/semantic/scrub";

import { createGithubClient, type GithubClient } from "./client";
import { githubReadiness, type ExecutionMode } from "./config";
import { LEASE_SECONDS, OPERATION_DEADLINE_MS } from "./constants";
import { GithubDefiniteError, GithubIndeterminateError } from "./errors";
import { OPERATIONS, type OperationResult } from "./operations";
import { redactValue } from "./redact";
import { parseRepositoryFullName } from "./validation";

export interface ExecuteInput {
  credentialSecret: string;
  tokenHash: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ExecuteResult {
  http: number;
  body: Record<string, unknown>;
}

export interface ExecutorDeps {
  mode: () => ExecutionMode;
  ready: () => { ready: boolean; missing: string[] };
  reserve: typeof reserveExecution;
  dispatch: typeof markDispatched;
  finish: typeof finishExecution;
  client: () => GithubClient;
  deadlineMs: number;
}

export const defaultExecutorDeps: ExecutorDeps = {
  mode: () => githubReadiness().mode,
  ready: () => githubReadiness(),
  reserve: reserveExecution,
  dispatch: markDispatched,
  finish: finishExecution,
  client: createGithubClient,
  deadlineMs: OPERATION_DEADLINE_MS,
};

const REJECTION_HTTP: Record<string, number> = {
  CAPABILITY_NOT_FOUND: 404,
  SCOPE_MISMATCH: 403,
  REPOSITORY_NOT_BOUND: 403,
  REPOSITORY_NOT_ALLOWED: 403,
  INSTALLATION_UNAVAILABLE: 403,
  CONNECTOR_NOT_SUPPORTED: 400,
  EXECUTION_MODE_MISMATCH: 409,
};

const DEFINITE_HTTP: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  AUTH_REJECTED: 502,
  UPSTREAM_ERROR: 502,
  REDIRECT_REJECTED: 502,
  DEADLINE_EXCEEDED: 504,
};

function definiteHttp(code: string): number {
  return DEFINITE_HTTP[code] ?? (code.startsWith("TRANSPORT_") ? 502 : 422);
}

const label = (mode: "mock" | "live") => ({ mode, simulated: mode === "mock" });

/**
 * Two-phase GitHub execution:
 *   reserve (atomic) -> pre-dispatch validation -> mint scoped token (memory)
 *   -> re-check revocation + mark dispatched -> constrained GitHub calls
 *   -> settle (consumed / failed / indeterminate) with an immutable receipt.
 *
 * A failure BEFORE dispatch releases the reservation (use refunded). Once a
 * request may have left, a failure is `failed` (definite refusal) or
 * `indeterminate` (outcome unknown) and is never retried automatically.
 */
export async function executeGithubOperation(input: ExecuteInput, deps: ExecutorDeps = defaultExecutorDeps): Promise<ExecuteResult> {
  const mode = deps.mode();
  if (mode === "disabled") {
    return { http: 503, body: { error: { code: "CONNECTOR_DISABLED", message: "The GitHub connector is not enabled." } } };
  }
  const readiness = deps.ready();
  if (!readiness.ready) {
    return { http: 503, body: { error: { code: "CONNECTOR_NOT_CONFIGURED", message: "The GitHub connector is not configured." } } };
  }
  const spec = OPERATIONS.get(input.tool);
  if (!spec) {
    return { http: 400, body: { error: { code: "OPERATION_NOT_SUPPORTED", message: "This operation is not supported by the GitHub connector." } } };
  }

  const reserved: ReserveResult = await deps.reserve({
    credentialSecret: input.credentialSecret,
    tokenHash: input.tokenHash,
    tool: input.tool,
    operation: input.operation,
    resource: input.resource,
    args: input.args,
    idempotencyKey: input.idempotencyKey,
    executionMode: mode,
    leaseSeconds: LEASE_SECONDS,
  });

  if (reserved.status !== "ok") {
    const c = failureContract(reserved.status);
    return { http: c.http, body: { error: { code: c.code, message: c.message } } };
  }
  if (reserved.result === "in_progress") {
    return { http: 409, body: { error: { code: "EXECUTION_IN_PROGRESS", message: "This execution is already in progress." }, executionId: reserved.executionId } };
  }
  if (reserved.result === "replayed") {
    return {
      http: 200,
      body: {
        replayed: true,
        executionId: reserved.executionId,
        status: reserved.previousStatus,
        execution: label(mode),
        receipt: reserved.previousReceipt,
        note: "The original result body is not stored; request a new capability to re-read.",
      },
    };
  }
  if (reserved.result !== "reserved" || !reserved.executionId || !reserved.agentId || !reserved.repository || !reserved.githubInstallationId) {
    const code = reserved.reasonCode ?? "CAPABILITY_REJECTED";
    return { http: REJECTION_HTTP[code] ?? 409, body: { error: { code, message: "The capability could not be used." } } };
  }

  const executionId = reserved.executionId;
  const agentId = reserved.agentId;
  const startedAt = new Date();
  const settle = async (
    category: ResultCategory,
    reasonCode: string | null,
    extra: Partial<FinishInput> = {},
  ): Promise<{ receiptId: string | null; finalStatus: string | null } | null> => {
    try {
      const r = await deps.finish({
        executionId,
        agentId,
        category,
        reasonCode,
        githubRequestId: null,
        httpStatusClass: null,
        resourceIds: {},
        beforeSha: null,
        afterSha: null,
        startedAt,
        redaction: {},
        ...extra,
      });
      return { receiptId: r.receiptId, finalStatus: r.finalStatus };
    } catch {
      safeLog("github executor: could not settle reservation (lease reconciliation will conclude it)");
      return null;
    }
  };
  const released = async (code: string, http: number): Promise<ExecuteResult> => {
    const s = await settle("released", code);
    return {
      http,
      body: { error: { code, message: "The request was not sent to GitHub." }, executionId, status: "released", receiptId: s?.receiptId ?? null, execution: label(mode) },
    };
  };

  // ---- pre-dispatch validation: a definite failure here releases the use ----
  const repo = parseRepositoryFullName(reserved.repository);
  if (!repo.ok) return released("REPOSITORY_INVALID", 422);
  let args: Record<string, unknown>;
  try {
    args = spec.parse(input.args);
    if (typeof args.repository === "string" && args.repository.toLowerCase() !== repo.value.fullName.toLowerCase()) {
      return released("REPOSITORY_MISMATCH", 403);
    }
    spec.precheck(args, { taskId: reserved.taskId!, defaultBranch: reserved.defaultBranch ?? "main" });
  } catch (error) {
    if (error instanceof GithubDefiniteError) return released(error.code, 422);
    if (error instanceof ZodError) return released("ARGUMENTS_INVALID", 400);
    return released("ARGUMENTS_INVALID", 400);
  }

  let client: GithubClient;
  let token;
  try {
    client = deps.client();
    token = await client.mintInstallationToken(reserved.githubInstallationId, repo.value.name, spec.permissions);
  } catch (error) {
    return released(error instanceof GithubDefiniteError ? error.code : "TOKEN_MINT_FAILED", 502);
  }

  // ---- last look at revocation, then the point of no return ----
  const dispatch = await deps.dispatch({ executionId, agentId });
  if (dispatch.status !== "ok") {
    const code = dispatch.reason ?? dispatch.status.toUpperCase();
    return {
      http: dispatch.status === "blocked" ? 403 : 409,
      body: { error: { code, message: "The execution could not be dispatched." }, executionId, execution: label(mode) },
    };
  }

  const controller = new AbortController();
  let writeStarted = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.deadlineMs);

  let outcome: OperationResult | null = null;
  let failure: { category: ResultCategory; code: string; http: number } | null = null;
  try {
    outcome = await spec.run(
      {
        client,
        token,
        owner: repo.value.owner,
        repo: repo.value.name,
        taskId: reserved.taskId!,
        signal: controller.signal,
        beforeWrite: () => {
          writeStarted = true;
        },
      },
      args,
      reserved.defaultBranch ?? "main",
    );
  } catch (error) {
    if (timedOut) {
      failure = { category: writeStarted ? "indeterminate" : "failed", code: "DEADLINE_EXCEEDED", http: 504 };
    } else if (error instanceof GithubIndeterminateError) {
      failure = { category: "indeterminate", code: error.code, http: 504 };
    } else if (error instanceof GithubDefiniteError) {
      failure = { category: "failed", code: error.code, http: definiteHttp(error.code) };
    } else {
      failure = { category: writeStarted ? "indeterminate" : "failed", code: "INTERNAL_ERROR", http: 500 };
    }
  } finally {
    clearTimeout(timer);
    token = null;
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
            ? "The outcome of this write is unknown. It has NOT been retried; inspect GitHub before requesting again."
            : "GitHub refused or could not complete the request.",
        },
        executionId,
        status: failure.category,
        receiptId: s?.receiptId ?? null,
        execution: label(mode),
      },
    };
  }

  const result = outcome!;
  const settled = await settle(result.category, null, {
    githubRequestId: result.githubRequestId,
    httpStatusClass: result.httpStatusClass,
    resourceIds: redactValue(JSON.parse(JSON.stringify(result.resourceIds)) as Record<string, unknown>),
    beforeSha: result.beforeSha,
    afterSha: result.afterSha,
    redaction: { counts: result.redaction },
  });
  if (!settled) {
    return {
      http: 503,
      body: {
        error: { code: "EXECUTION_STATE_UNKNOWN", message: "The operation ran but its receipt could not be recorded; do not retry." },
        executionId,
        execution: label(mode),
      },
    };
  }
  return {
    http: 200,
    body: {
      result: result.category,
      executionId,
      receiptId: settled.receiptId,
      execution: label(mode),
      resource: result.resourceIds,
      data: result.agentPayload,
    },
  };
}
