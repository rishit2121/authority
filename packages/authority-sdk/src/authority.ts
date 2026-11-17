import { AuthorityAgentClient } from "./agent-client.js";
import { AuthorityBackendClient } from "./backend-client.js";
import { AuthorityApiError, AuthorityConfigError } from "./errors.js";
import { requestWithMeta, type ClientConfig, type FetchLike, type RequestOptions } from "./http.js";
import { AuthorityTask } from "./task.js";
import type {
  CandidatePlanInput,
  CandidatePlanNodeInput,
  ExcludedStep,
  PlanAlignment,
  PrepareBudgets,
  TaskSessionResponse,
} from "./types.js";

export type SideEffect = "read" | "write_create" | "write_update" | "write_delete" | "admin";

/**
 * Side effects of common built-in tools, so a plan for them need not spell it out. Any tool not listed here
 * (a Custom API or Postgres operation, a sensitive read) must declare `expectedSideEffect` explicitly.
 */
export const KNOWN_SIDE_EFFECTS: Readonly<Record<string, SideEffect>> = Object.freeze({
  "slack.post_message": "write_create",
  "slack.list_channels": "read",
  "gmail.send_email": "write_create",
  "gmail.list_labels": "read",
  "gmail.list_messages": "read",
  "gmail.get_message": "read",
  "github.get_issue": "read",
  "github.get_pull_request": "read",
  "github.read_repository": "read",
  "github.create_branch": "write_create",
  "github.put_file": "write_update",
  "github.push_commit": "write_update",
  "github.create_pull_request": "write_create",
  "github.delete_branch": "write_delete",
  "stripe.retrieve_payment": "read",
  "stripe.retrieve_customer": "read",
  "stripe.list_charges": "read",
  "stripe.issue_refund": "write_create",
});

export interface AuthorityOptions {
  /** The Authority deployment's origin, e.g. "https://authority.example.com". */
  baseUrl: string;
  /** Developer backend credential (`authority_dk_...`). Server-side only; never ship it to a browser. */
  backendKey: string;
  /** The agent every task is created for. */
  agentId: string;
  /** That agent's runtime key (`authority_rk_...`). Used only to open task sessions. */
  runtimeKey: string;
  defaultTimeoutMs?: number;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

export interface TaskAction {
  /** Provider-qualified tool, e.g. "slack.post_message". */
  tool: string;
  /** Values pinned into the contract (a channel, a recipient). The model cannot change these. */
  arguments?: Record<string, string | number | boolean>;
  /** Free-text keys the agent writes at run time (a message body). Never a recipient, channel, id or amount. */
  agentGenerated?: string[];
  /** Defaults to 1. */
  maxInvocations?: number;
  /** Required unless the tool is in `KNOWN_SIDE_EFFECTS`. */
  expectedSideEffect?: SideEffect;
  resourceBinding?: string;
}

export interface PrepareTaskRequest {
  /** Your application's authenticated user id; becomes the Authority customer's `externalId`. Trusted input. */
  userId: string;
  /** The user's request, in your words; becomes the task intent. Trusted input. */
  request: string;
  /**
   * Connector id -> connection id, chosen by your application (e.g. `{ slack: "<connection uuid>" }`). Exactly
   * these are bound to the task; the SDK never picks a connection. Every action's provider needs an entry.
   * GitHub is not a connection: pass `githubRepositoryId` instead.
   */
  connections: Record<string, string>;
  actions: TaskAction[];
  /** For `github.*` actions: a repository delegated to this user (`backend.githubRepositories.list`). */
  githubRepositoryId?: string;
  /**
   * Covers task creation and prepare (sent as `<key>:task` and `<key>:prepare`). Defaults to a hash of the agent,
   * user, request, connections and actions -- so the same request maps to the same task. Pass your own key per
   * logical run (a request or event id) when the same request may legitimately be made again later.
   */
  idempotencyKey?: string;
  /** Renew task-wide budgets when the contract activates. An explicit backend decision; never automatic. */
  raiseBudgets?: boolean;
  /**
   * When the server accepts only part of the plan (`excludedSteps` non-empty), return `partial` without opening
   * a session unless this is true. Defaults to false.
   */
  allowPartial?: boolean;
  /** 60-900. Defaults to the server's 900. */
  sessionTtlSeconds?: number;
  signal?: AbortSignal;
  /** Per request. Prepare itself defaults to 60s (it may wait on plan review). */
  timeoutMs?: number;
}

interface PreparedBase {
  taskId: string;
  customerId: string;
}

export type PrepareTaskResult =
  | (PreparedBase & {
      status: "ready";
      task: AuthorityTask;
      contractId: string;
      version: number;
      tools: string[];
      budgets: PrepareBudgets;
      /** Always empty unless `allowPartial` was set. */
      excludedSteps: ExcludedStep[];
      alignment?: PlanAlignment;
      checks?: { planReview: "ran" | "not_run" };
    })
  /**
   * The server activated a contract that leaves out some of your actions. No session was opened. Fix the plan, or
   * accept the narrower contract explicitly with `authority.openTask(taskId)` (or `allowPartial: true`).
   */
  | (PreparedBase & {
      status: "partial";
      contractId: string;
      version: number;
      tools: string[];
      budgets: PrepareBudgets;
      excludedSteps: ExcludedStep[];
      alignment?: PlanAlignment;
    })
  /** A person must activate the contract at `approvalPath`; then call `authority.openTask(taskId)`. */
  | (PreparedBase & {
      status: "awaiting_approval";
      contractId: string;
      version: number;
      approvalPath: string;
      budgets: PrepareBudgets;
      excludedSteps: ExcludedStep[];
      alignment?: PlanAlignment;
    })
  /** Enforced alignment review did not clear the plan: "revise" it, or wait for a person ("hold"). */
  | (PreparedBase & {
      status: "alignment_review";
      decision: "revise" | "hold";
      reviewPath: string;
      alignment: PlanAlignment;
      contractId: string;
      version: number;
      budgets: PrepareBudgets;
      excludedSteps: ExcludedStep[];
    })
  | (PreparedBase & { status: "clarification"; reason: string; details?: unknown })
  | (PreparedBase & { status: "rejected"; reason: string })
  | (PreparedBase & { status: "ai_unavailable" });

export type PrepareTaskStatus = PrepareTaskResult["status"];

export interface OpenTaskOptions extends RequestOptions {
  /** 60-900. Defaults to the server's 900. */
  ttlSeconds?: number;
}

const TOOL_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const SIDE_EFFECTS: ReadonlySet<string> = new Set([
  "read",
  "write_create",
  "write_update",
  "write_delete",
  "admin",
]);
const MAX_KEY_LENGTH = 180;

function config(message: string): never {
  throw new AuthorityConfigError(message);
}

function requireString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") config(`${name} is required.`);
  if (value.length > max) config(`${name} must be at most ${max} characters.`);
  return value;
}

function validateTtl(ttl: unknown, name: string): number | undefined {
  if (ttl === undefined) return undefined;
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 60 || ttl > 900) {
    config(`${name} must be an integer between 60 and 900.`);
  }
  return ttl;
}

/** Deterministic JSON: object keys sorted, so equal inputs hash equally. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function deriveIdempotencyKey(parts: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) config("No Web Crypto in this runtime: pass idempotencyKey explicitly.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(stableStringify(parts)));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sdk_${hex.slice(0, 48)}`;
}

/** Validates everything and builds the plan before any request is made. */
function buildPlan(input: PrepareTaskRequest): {
  nodes: CandidatePlanNodeInput[];
  connections: Array<{ connectorId: string; connectionId: string }>;
} {
  if (!input || typeof input !== "object") config("prepareTask requires an input object.");
  requireString(input.userId, "userId", 200);
  requireString(input.request, "request", 4000);
  if (!input.connections || typeof input.connections !== "object" || Array.isArray(input.connections)) {
    config("connections must be an object mapping connector id to connection id (use {} for none).");
  }
  const connections = Object.entries(input.connections).map(([connectorId, connectionId]) => {
    if (connectorId === "github") {
      config(
        "GitHub is bound by repository, not connection: pass githubRepositoryId instead of connections.github.",
      );
    }
    requireString(connectionId, `connections.${connectorId}`, 100);
    return { connectorId, connectionId };
  });
  if (input.githubRepositoryId !== undefined)
    requireString(input.githubRepositoryId, "githubRepositoryId", 100);
  if (!Array.isArray(input.actions) || input.actions.length === 0)
    config("actions must list at least one action.");
  if (input.actions.length > 50) config("actions may list at most 50 actions.");

  const nodes = input.actions.map((action, index): CandidatePlanNodeInput => {
    const where = `actions[${index}]`;
    if (!action || typeof action.tool !== "string" || !TOOL_RE.test(action.tool)) {
      config(`${where}.tool must be provider-qualified, e.g. "slack.post_message".`);
    }
    const provider = action.tool.slice(0, action.tool.indexOf("."));
    if (provider === "github") {
      if (input.githubRepositoryId === undefined) {
        config(
          `${where} (${action.tool}) needs githubRepositoryId: GitHub tools act on one bound repository.`,
        );
      }
    } else if (!Object.prototype.hasOwnProperty.call(input.connections, provider)) {
      config(
        `${where} (${action.tool}) needs connections["${provider}"]: choose which of the user's connections this task uses.`,
      );
    }
    const args = action.arguments ?? {};
    if (typeof args !== "object" || args === null || Array.isArray(args))
      config(`${where}.arguments must be an object.`);
    for (const [key, value] of Object.entries(args)) {
      if (!["string", "number", "boolean"].includes(typeof value)) {
        config(`${where}.arguments.${key} must be a string, number or boolean (a pinned value).`);
      }
    }
    const sideEffect = action.expectedSideEffect ?? KNOWN_SIDE_EFFECTS[action.tool];
    if (sideEffect === undefined) {
      config(
        `${where} (${action.tool}) needs expectedSideEffect: the SDK does not know this tool's side effect.`,
      );
    }
    if (!SIDE_EFFECTS.has(sideEffect))
      config(`${where}.expectedSideEffect "${String(sideEffect)}" is not valid.`);
    const maxInvocations = action.maxInvocations ?? 1;
    if (!Number.isInteger(maxInvocations) || maxInvocations < 1 || maxInvocations > 20) {
      config(`${where}.maxInvocations must be an integer between 1 and 20.`);
    }
    if (action.agentGenerated !== undefined) {
      if (
        !Array.isArray(action.agentGenerated) ||
        action.agentGenerated.some((k) => typeof k !== "string" || k === "")
      ) {
        config(`${where}.agentGenerated must be a list of argument keys.`);
      }
      if (new Set(action.agentGenerated).size !== action.agentGenerated.length) {
        config(`${where}.agentGenerated keys must be unique.`);
      }
      const pinnedAndGenerated = action.agentGenerated.filter((k) =>
        Object.prototype.hasOwnProperty.call(args, k),
      );
      if (pinnedAndGenerated.length > 0) {
        config(
          `${where}: "${pinnedAndGenerated.join('", "')}" cannot be both pinned in arguments and agentGenerated.`,
        );
      }
    }
    if (action.resourceBinding !== undefined)
      requireString(action.resourceBinding, `${where}.resourceBinding`, 500);
    return {
      id: `a${index + 1}`,
      sequence: index,
      tool: action.tool,
      arguments: { ...args },
      ...(action.resourceBinding !== undefined ? { resourceBinding: action.resourceBinding } : {}),
      dependencies: [],
      declaredOutputs: [],
      dataFlowRefs: [],
      ...(action.agentGenerated !== undefined ? { agentGenerated: [...action.agentGenerated] } : {}),
      expectedSideEffect: sideEffect,
      maxInvocations,
    };
  });
  return { nodes, connections };
}

/**
 * The server-side entry point: turn one trusted user request into one task-bound handle.
 *
 * Holds three credentials, each used for exactly one purpose and never mutated: the backend key (customers,
 * tasks, prepare), the runtime key (opening task sessions only), and -- inside each `AuthorityTask` -- that
 * task's own session token. Opening task B never changes task A.
 */
export class Authority {
  /** The existing low-level backend client (stateless; safe to share). */
  readonly backend: AuthorityBackendClient;
  /**
   * The existing low-level clients, unchanged. `createAgentClient()` returns a NEW `AuthorityAgentClient` each
   * time because that class replaces its own token on `sessions.create` -- one instance per task.
   */
  readonly lowLevel: Readonly<{
    backend: AuthorityBackendClient;
    createAgentClient: () => AuthorityAgentClient;
  }>;

  readonly #agentId: string;
  readonly #baseUrl: string;
  readonly #runtime: Readonly<ClientConfig>;
  readonly #defaultTimeoutMs?: number;
  readonly #fetch?: FetchLike;

  constructor(options: AuthorityOptions) {
    if (!options || typeof options !== "object") config("new Authority() requires options.");
    requireString(options.baseUrl, "baseUrl", 2000);
    try {
      new URL(options.baseUrl);
    } catch {
      config("baseUrl must be an absolute URL, e.g. https://authority.example.com.");
    }
    requireString(options.backendKey, "backendKey", 500);
    requireString(options.agentId, "agentId", 100);
    requireString(options.runtimeKey, "runtimeKey", 500);

    this.#agentId = options.agentId;
    this.#baseUrl = options.baseUrl;
    this.#defaultTimeoutMs = options.defaultTimeoutMs;
    this.#fetch = options.fetch;
    this.#runtime = Object.freeze({
      baseUrl: options.baseUrl,
      token: options.runtimeKey,
      defaultTimeoutMs: options.defaultTimeoutMs,
      fetch: options.fetch,
    });
    this.backend = new AuthorityBackendClient({
      baseUrl: options.baseUrl,
      apiKey: options.backendKey,
      defaultTimeoutMs: options.defaultTimeoutMs,
      fetch: options.fetch,
    });
    const runtimeKey = options.runtimeKey;
    this.lowLevel = Object.freeze({
      backend: this.backend,
      createAgentClient: () =>
        new AuthorityAgentClient({
          baseUrl: options.baseUrl,
          token: runtimeKey,
          defaultTimeoutMs: options.defaultTimeoutMs,
          fetch: options.fetch,
        }),
    });
    Object.freeze(this);
  }

  /**
   * Ensure the customer, create the task with exactly your connections, prepare a deterministic plan, and -- only
   * when the whole plan is active -- open a task session. Every other outcome is returned as-is: nothing is
   * re-prepared, widened or approved for you. Validation errors throw `AuthorityConfigError` before any request.
   */
  async prepareTask(input: PrepareTaskRequest): Promise<PrepareTaskResult> {
    const { nodes, connections } = buildPlan(input);
    const sessionTtl = validateTtl(input.sessionTtlSeconds, "sessionTtlSeconds");
    const key =
      input.idempotencyKey !== undefined
        ? requireString(input.idempotencyKey, "idempotencyKey", MAX_KEY_LENGTH)
        : await deriveIdempotencyKey({
            agentId: this.#agentId,
            userId: input.userId,
            request: input.request,
            connections: [...connections].sort((a, b) => (a.connectorId < b.connectorId ? -1 : 1)),
            githubRepositoryId: input.githubRepositoryId,
            raiseBudgets: input.raiseBudgets,
            nodes,
          });
    const options: RequestOptions = { signal: input.signal, timeoutMs: input.timeoutMs };

    const { customerId } = await this.backend.customers.ensure({ externalId: input.userId }, options);
    const { taskId } = await this.backend.tasks.create(
      {
        customerId,
        agentId: this.#agentId,
        intent: input.request,
        connections,
        idempotencyKey: `${key}:task`,
      },
      options,
    );
    if (input.githubRepositoryId !== undefined) {
      try {
        await this.backend.tasks.bindGithubRepository(taskId, input.githubRepositoryId, options);
      } catch (error) {
        // A retried prepareTask re-creates the same task (idempotent); its repository is already bound.
        if (!(error instanceof AuthorityApiError) || error.code !== "ALREADY_BOUND") throw error;
      }
    }

    const plan: CandidatePlanInput = { schemaVersion: 1, nodes };
    const outcome = await this.backend.tasks.prepare(
      taskId,
      input.raiseBudgets !== undefined ? { plan, raiseBudgets: input.raiseBudgets } : { plan },
      `${key}:prepare`,
      options,
    );

    const base = { taskId, customerId };
    switch (outcome.status) {
      case "ready": {
        const excludedSteps = outcome.excludedSteps ?? [];
        const shared = {
          ...base,
          contractId: outcome.contractId,
          version: outcome.version,
          tools: outcome.tools,
          budgets: outcome.budgets,
          excludedSteps,
          ...(outcome.alignment ? { alignment: outcome.alignment } : {}),
        };
        if (excludedSteps.length > 0 && input.allowPartial !== true) return { ...shared, status: "partial" };
        const task = await this.openTask(taskId, { ...options, ttlSeconds: sessionTtl });
        return { ...shared, status: "ready", task, ...(outcome.checks ? { checks: outcome.checks } : {}) };
      }
      case "awaiting_approval":
        return {
          ...base,
          status: "awaiting_approval",
          contractId: outcome.contractId,
          version: outcome.version,
          approvalPath: outcome.approvalPath,
          budgets: outcome.budgets,
          excludedSteps: outcome.excludedSteps ?? [],
          ...(outcome.alignment ? { alignment: outcome.alignment } : {}),
        };
      case "alignment_review":
        return {
          ...base,
          status: "alignment_review",
          decision: outcome.decision,
          reviewPath: outcome.reviewPath,
          alignment: outcome.alignment,
          contractId: outcome.contractId,
          version: outcome.version,
          budgets: outcome.budgets,
          excludedSteps: outcome.excludedSteps ?? [],
        };
      case "clarification":
        return {
          ...base,
          status: "clarification",
          reason: outcome.reason,
          ...(outcome.details !== undefined ? { details: outcome.details } : {}),
        };
      case "rejected":
        return { ...base, status: "rejected", reason: outcome.reason };
      case "ai_unavailable":
        return { ...base, status: "ai_unavailable" };
      default:
        throw new AuthorityApiError(
          `Unexpected prepare status "${String((outcome as { status?: unknown }).status)}".`,
          {
            status: 200,
            code: "UNEXPECTED_OUTCOME",
          },
        );
    }
  }

  /**
   * Open a new, independent handle on a task whose contract is active -- e.g. after a person approved it, or to
   * accept a `partial` contract deliberately. Each call opens its own session with the runtime key.
   */
  async openTask(taskId: string, options: OpenTaskOptions = {}): Promise<AuthorityTask> {
    requireString(taskId, "taskId", 100);
    const ttlSeconds = validateTtl(options.ttlSeconds, "ttlSeconds");
    const { body } = await requestWithMeta<TaskSessionResponse>(
      this.#runtime,
      "/api/v1/sessions",
      { method: "POST", body: ttlSeconds !== undefined ? { taskId, ttlSeconds } : { taskId } },
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );
    if (
      typeof body?.token !== "string" ||
      typeof body.sessionId !== "string" ||
      body.taskId !== taskId ||
      typeof body.expiresAt !== "string" ||
      !body.contract
    ) {
      throw new AuthorityApiError("The session response was incomplete.", {
        status: 200,
        code: "INVALID_RESPONSE",
      });
    }
    return new AuthorityTask({
      baseUrl: this.#baseUrl,
      session: body,
      defaultTimeoutMs: this.#defaultTimeoutMs,
      fetch: this.#fetch,
    });
  }
}
