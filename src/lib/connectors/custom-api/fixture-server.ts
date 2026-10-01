import "server-only";

import type { SafeFetchInput, SafeFetchResult } from "./network-guard";

/**
 * The in-process "Widget Orders" fixture API, reachable only at
 * `CUSTOM_API_FIXTURE_HOSTNAME` and only when `customApiFixtureModeEnabled()`
 * is true (see fixture-mode.ts). Used for local development and the e2e
 * suite's full customer-workflow proof: a connection's base URL points at
 * this reserved hostname, and every request the real connector builds
 * (method, path, headers, body -- the exact same code path a real tenant
 * API would receive) is answered here instead of over a real socket.
 *
 * One process-wide instance, matching the lifetime of the dev/e2e server
 * itself. `reset()` clears both the order data and the request log between
 * test runs; a dedicated internal route (see
 * src/app/api/internal/custom-api-fixture/route.ts) exposes read/reset for
 * exactly this purpose, itself gated behind the same fixture-mode check.
 */
export interface FixtureOrder {
  id: string;
  status: string;
}

export interface FixtureRequestLogEntry {
  method: string;
  path: string;
  authorization: string | null;
  at: string;
}

// A function, not a shared array of object literals: `new Map(INITIAL_ORDERS)`
// would otherwise copy references to the SAME FixtureOrder objects every
// time, so an in-place mutation from one test/run (order.status = "cancelled")
// would silently persist across every later reset().
function initialOrders(): Array<[string, FixtureOrder]> {
  return [
    ["4821", { id: "4821", status: "pending" }],
    ["5190", { id: "5190", status: "pending" }],
  ];
}

class WidgetOrdersFixtureServer {
  orders = new Map<string, FixtureOrder>(initialOrders());
  requestLog: FixtureRequestLogEntry[] = [];

  reset(): void {
    this.orders = new Map(initialOrders());
    this.requestLog = [];
  }

  handle = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requestLog.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
      at: new Date().toISOString(),
    });

    const getMatch = /^\/v1\/orders\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && getMatch) {
      const order = this.orders.get(getMatch[1]);
      return order ? json(200, order) : json(404, { error: "order not found" });
    }

    const cancelMatch = /^\/v1\/orders\/([^/]+)\/cancel$/.exec(input.url.pathname);
    if (input.method === "POST" && cancelMatch) {
      const order = this.orders.get(cancelMatch[1]);
      if (!order) return json(404, { error: "order not found" });
      order.status = "cancelled";
      return json(200, order);
    }

    return json(404, { error: "no such route on the fixture API" });
  };
}

function json(status: number, body: unknown): SafeFetchResult {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    bodyText: JSON.stringify(body),
    truncated: false,
  };
}

const globalForFixture = globalThis as unknown as { __customApiFixtureServer?: WidgetOrdersFixtureServer };

export function customApiFixtureServer(): WidgetOrdersFixtureServer {
  if (!globalForFixture.__customApiFixtureServer) {
    globalForFixture.__customApiFixtureServer = new WidgetOrdersFixtureServer();
  }
  return globalForFixture.__customApiFixtureServer;
}
