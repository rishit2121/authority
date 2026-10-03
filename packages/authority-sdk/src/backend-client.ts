import { request, type ClientConfig, type RequestOptions } from "./http.js";
import type { CandidatePlanInput, ContractStatus, CustomerConnection, PrepareTaskOutcome } from "./types.js";

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
     */
    prepare: (
      taskId: string,
      input: { plan: CandidatePlanInput } | { generate: true },
      idempotencyKey?: string,
      options?: RequestOptions,
    ) =>
      request<PrepareTaskOutcome & { taskId: string }>(
        this.config,
        `/api/v1/tasks/${taskId}/prepare`,
        { method: "POST", body: { ...input, idempotencyKey } },
        options,
      ),
  };

  contracts = {
    getStatus: (contractId: string, options?: RequestOptions) =>
      request<ContractStatus>(this.config, `/api/v1/contracts/${contractId}`, { method: "GET" }, options),
  };
}
