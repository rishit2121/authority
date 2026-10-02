/**
 * A dependency-free client for Authority's developer API (Node 20+) -- the
 * backend-credential-authenticated surface, not the agent-facing one (see
 * ../agent/authority-client.mjs for that). Everything here is what Acme's
 * own server would call: create/resolve a customer, open or register a
 * connection, create a customer-scoped task. Never used by, or exposed to,
 * an agent, a browser, or an end user.
 *
 * The backend credential (`authority_dk_...`) is sent only in the
 * Authorization header and is never logged by this file.
 */

export class BackendApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "BackendApiError";
    this.status = status;
    this.code = code;
  }
}

export function createBackendClient({ baseUrl, backendKey }) {
  if (!baseUrl) throw new Error("createBackendClient: baseUrl is required");
  if (!backendKey) throw new Error("createBackendClient: backendKey is required");

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${backendKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new BackendApiError(parsed?.error?.message ?? `HTTP ${response.status}`, {
        status: response.status,
        code: parsed?.error?.code,
      });
    }
    return parsed;
  }

  return {
    /** Create or resolve a customer by your own opaque external id. Idempotent. */
    createOrResolveCustomer: (externalId, { displayLabel, metadata } = {}) =>
      request("/api/v1/customers", { method: "POST", body: { externalId, displayLabel, metadata } }),

    /** Every connection this customer may use right now -- their own, plus anything delegated to them. */
    listCustomerConnections: (customerId) => request(`/api/v1/customers/${customerId}/connections`),

    /** Opens a Mode A embedded connection session; redirect a real browser to the returned `url`. */
    createConnectionSession: (customerId, connectorId, returnUrl) =>
      request("/api/v1/connections/sessions", {
        method: "POST",
        body: { customerId, connectorId, returnUrl },
      }),

    /** Poll after the browser returns, to find out whether the connection completed. */
    connectionSessionStatus: (sessionId) => request(`/api/v1/connections/sessions/${sessionId}`),

    /** Registers a Mode B (credential-broker) connection -- no token sent here, ever. */
    registerBrokerConnection: (
      customerId,
      { connectorId, brokerId, brokerConnectionRef, verifiedAccountRef },
    ) =>
      request(`/api/v1/customers/${customerId}/connections/broker`, {
        method: "POST",
        body: { connectorId, brokerId, brokerConnectionRef, verifiedAccountRef },
      }),

    /** Creates a task with its connector bindings set atomically and explicitly. */
    createCustomerTask: (customerId, { agentId, intent, connections, idempotencyKey }) =>
      request(`/api/v1/customers/${customerId}/tasks`, {
        method: "POST",
        body: { agentId, intent, connections, idempotencyKey },
      }),
  };
}
