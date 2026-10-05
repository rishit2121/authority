#!/usr/bin/env node
/**
 * A tiny, deployable demo API for live-testing Authority's Custom API
 * connector against a real HTTPS endpoint -- not a fixture, not a mock
 * inside this repo's own process. Every "order" is fixed, disposable demo
 * data; nothing here is ever written to, so there is nothing real to break.
 *
 * GET  /healthz          -> 200, no auth (Render's health check).
 * GET  /v1/orders/:id    -> requires `Authorization: Bearer <DEMO_BEARER_TOKEN>`;
 *                           200 with a fixed order for a few known disposable
 *                           ids, 404 for anything else, 401 for a missing or
 *                           wrong bearer token.
 *
 * Deliberately read-only and zero-dependency: this server has no database,
 * no write endpoint, and no request body parsing at all -- there is no
 * attack surface beyond "leaks fixed demo data without the right token,"
 * which is exactly what the bearer check prevents.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8787);
const BEARER_TOKEN = process.env.DEMO_BEARER_TOKEN;
if (!BEARER_TOKEN) {
  console.error("Missing DEMO_BEARER_TOKEN. Set it to any random string before starting this server.");
  process.exit(1);
}

const ORDERS = {
  4821: { id: "4821", status: "fulfilled", total_cents: 4999, currency: "usd" },
  4822: { id: "4822", status: "pending", total_cents: 1250, currency: "usd" },
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  const match = url.pathname.match(/^\/v1\/orders\/([^/]+)$/);
  if (req.method === "GET" && match) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${BEARER_TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const order = ORDERS[match[1]];
    if (!order) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(order));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, () => {
  console.log(`Demo API listening on :${PORT}`);
});
