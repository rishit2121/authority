import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";

/**
 * A local, in-memory fixture API standing in for a tenant's real third-party
 * service ("Widget Orders") -- the Custom API connector equivalent of
 * `mockGithub` (src/lib/github/mock.ts). It is injected as the connector's
 * own `fetch` dependency (`CustomApiConnectorDeps.fetch`), never a real
 * socket: Custom API's SSRF guard (network-guard.ts) correctly refuses
 * loopback/private destinations in every environment, including this one,
 * so a literal `http.createServer` on localhost is not a usable fixture
 * here -- the same reason GitHub's own tests use an in-memory mock instead
 * of a real GitHub sandbox.
 *
 * Exercises the exact same request shape the real connector builds
 * (method, URL, headers, body) and the exact same response contract
 * (`SafeFetchResult`) `safeFetch` would hand back from a real socket, so
 * everything upstream of the network call -- request building, auth
 * resolution, response parsing, settlement -- runs unmodified.
 */
export interface FixtureOrder {
  id: string;
  status: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
}

export class WidgetOrdersFixtureApi {
  readonly orders = new Map<string, FixtureOrder>([
    ["4821", { id: "4821", status: "pending" }],
    ["5190", { id: "5190", status: "pending" }],
  ]);
  readonly requests: RecordedRequest[] = [];
  requiredBearerToken: string | null = null;

  /** Matches `CustomApiConnectorDeps["fetch"]` exactly -- drop-in for `safeFetch` in tests. */
  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requests.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
    });

    if (this.requiredBearerToken && input.headers.authorization !== `Bearer ${this.requiredBearerToken}`) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const getMatch = /^\/v1\/orders\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && getMatch) {
      const order = this.orders.get(getMatch[1]);
      if (!order) return jsonResponse(404, { error: "order not found" });
      return jsonResponse(200, order);
    }

    const cancelMatch = /^\/v1\/orders\/([^/]+)\/cancel$/.exec(input.url.pathname);
    if (input.method === "POST" && cancelMatch) {
      const order = this.orders.get(cancelMatch[1]);
      if (!order) return jsonResponse(404, { error: "order not found" });
      order.status = "cancelled";
      return jsonResponse(200, order);
    }

    return jsonResponse(404, { error: "no such route on the fixture API" });
  };
}

function jsonResponse(status: number, body: unknown): SafeFetchResult {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    bodyText: JSON.stringify(body),
    truncated: false,
  };
}
