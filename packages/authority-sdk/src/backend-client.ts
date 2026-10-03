import { request, type ClientConfig, type RequestOptions } from "./http.js";
import type {
  CandidatePlanInput,
  ContractStatus,
  CustomerConnection,
  CustomerGithubRepository,
  PrepareTaskOutcome,
} from "./types.js";

export interface AuthorityBackendClientOptions {
  /** The Authority deployment's origin, e.g. "https://authority.example.com" or "http://localhost:3000". */
  baseUrl: string;
  /** A developer backend credential (`authority_dk_...`), from Settings -> Applications -> Backend credentials. Never an agent runtime key or session token. */
  apiKey: string;
  defaultTimeoutMs?: number;
}

/**
 * The application-backend side of the Authority developer API: create or
 * resolve your own customers, start a connection for one, and get a task
 * ready to run -- everything a server does on its own, never in a browser
 * (this credential must never reach client-side code).
 */
export class AuthorityBackendClient {
  private readonly config: ClientConfig;

  constructor(options: AuthorityBackendClientOptions) {
    this.config = {
      baseUrl: options.baseUrl,
      token: options.apiKey,
      defaultTimeoutMs: options.defaultTimeoutMs,
    };
  }

  customers = {
    /** Idempotent by `externalId`: calling this again for the same end user always resolves the same customer. */
    ensure: (
      input: { externalId: string; displayLabel?: string; metadata?: Record<string, unknown> },
      options?: RequestOptions,
    ) =>
      request<{ customerId: string; wasCreated: boolean }>(
        this.config,
        "/api/v1/customers",
        { method: "POST", body: input },
        options,
      ),
  };

  connections = {
    /** Every connection this customer may use right now (their own, plus any organization connection delegated to them). */
    list: (customerId: string, options?: RequestOptions) =>
      request<{ connections: CustomerConnection[] }>(
        this.config,
        `/api/v1/customers/${customerId}/connections`,
        { method: "GET" },
        options,
      ),

    /**
     * Opens a short-lived, single-use connection session. The response's
     * `url` is a path on this same Authority deployment -- redirect your end
     * user's browser there; they complete provider consent and are sent back
     * to your own `returnUrl`, which must already be registered on this
     * application (Settings -> Applications -> Return URLs).
     */
    start: (
      input: { customerId: string; connectorId: string; returnUrl: string },
      options?: RequestOptions,
    ) =>
      request<{ sessionId: string; url: string; expiresAt: string }>(
        this.config,
        "/api/v1/connections/sessions",
        { method: "POST", body: input },
        options,
      ),
  };

  /**
   * GitHub repositories, kept separate from `connections` above: a GitHub
   * repository is never an OAuth connection, so it cannot be named in
   * `tasks.create`'s own `connections` array -- bind one to a task via
   * `tasks.bindGithubRepository` as a distinct step instead, the same way a
   * human developer already binds a repository on the dashboard separately
   * from creating the task itself.
   */
  githubRepositories = {
    /** Every repository explicitly delegated to this customer (Settings -> Applications -> an admin action). */
    list: (customerId: string, options?: RequestOptions) =>
      request<{ repositories: CustomerGithubRepository[] }>(
        this.config,
        `/api/v1/customers/${customerId}/github-repositories`,
        { method: "GET" },
        options,
      ),
  };

  tasks = {
    /** Creates a customer-scoped task with its connector bindings set atomically, before any contract can be proposed. */
    create: (
      input: {
        customerId: string;
        agentId: string;
        intent: string;
        connections?: Array<{ connectorId: string; connectionId: string }>;
        idempotencyKey?: string;
      },
      options?: RequestOptions,
    ) =>
      request<{ taskId: string; wasCreated: boolean }>(
        this.config,
        `/api/v1/customers/${input.customerId}/tasks`,
        {
          method: "POST",
          body: {
            agentId: input.agentId,
            intent: input.intent,
            connections: input.connections,
            idempotencyKey: input.idempotencyKey,
          },
        },
        options,
      ),

    /**
     * Submits a candidate plan (structured, or `{ generate: true }` for an
     * AI-drafted one) and runs it through the same validate -> solve ->
     * compile -> verify pipeline the dashboard uses, then attempts automatic
     * activation. Always resolves to a typed outcome -- "awaiting_approval"
     * and "clarification" are expected, common results, never errors. Poll
     * `contracts.getStatus` on an "awaiting_approval" outcome's `contractId`
     * until a human activates or rejects it on the dashboard.
     *
     * `CandidatePlanInput` has no `taskId` field of its own -- the server's
     * candidate-plan schema requires one (and, on the dashboard path,
     * enforces it matches the task being proposed for), but a caller here
     * already named the task as this method's own first argument, so this
     * stamps it onto the plan before sending rather than making every
     * backend-API caller repeat it a second time, redundantly, inside the
     * plan body itself.
     */
    prepare: (
      taskId: string,
      input: { plan: CandidatePlanInput } | { generate: true },
      idempotencyKey?: string,
      options?: RequestOptions,
    ) => {
      const body =
        "plan" in input ? { plan: { ...input.plan, taskId }, idempotencyKey } : { ...input, idempotencyKey };
      return request<PrepareTaskOutcome & { taskId: string }>(
        this.config,
        `/api/v1/tasks/${taskId}/prepare`,
        { method: "POST", body },
        options,
      );
    },

    /**
     * Binds a task to a GitHub repository delegated to that task's own
     * customer (`githubRepositories.list` discovers which ones). Required
     * once, before `tasks.prepare` compiles a contract containing any
     * `github.*` tool -- this call grants no tool authority by itself, it
     * only makes the repository available for the deterministic pipeline
     * to bind a plan node's resource against.
     */
    bindGithubRepository: (taskId: string, repositoryId: string, options?: RequestOptions) =>
      request<{ taskId: string; repositoryId: string }>(
        this.config,
        `/api/v1/tasks/${taskId}/github-repository`,
        { method: "POST", body: { repositoryId } },
        options,
      ),
  };

  contracts = {
    getStatus: (contractId: string, options?: RequestOptions) =>
      request<ContractStatus>(this.config, `/api/v1/contracts/${contractId}`, { method: "GET" }, options),
  };
}
