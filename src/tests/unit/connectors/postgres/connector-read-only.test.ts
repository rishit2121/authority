import { describe, expect, it } from "vitest";

import { toPostgresConnectorId } from "@/lib/connectors/postgres/connection-id";
import { createPostgresConnector, defaultPostgresConnectorDeps } from "@/lib/connectors/postgres/connector";

/** The connector passes `readOnly` for a query published as a read, so pg-client wraps it in BEGIN READ ONLY. */

const connectionId = "5a1f3c2e-0000-4000-8000-000000000001";
const tool = `${toPostgresConnectorId(connectionId)}.orders`;

function connectorFor(effect: "read" | "write_update") {
  const calls: Array<{ readOnly?: boolean; sql: string }> = [];
  const connector = createPostgresConnector({
    ...defaultPostgresConnectorDeps,
    getPublishedQuery: async () => ({
      queryId: "q1",
      toolName: tool,
      sqlTemplate:
        effect === "read"
          ? "select id from orders where id = :id"
          : "update orders set note = :note where id = :id",
      effect,
      inputSchema: {
        schemaVersion: 1,
        fields:
          effect === "read"
            ? [{ key: "id", type: "string", required: true, identifiesResource: true }]
            : [
                { key: "id", type: "string", required: true, identifiesResource: true },
                { key: "note", type: "string", required: true, identifiesResource: false },
              ],
      },
      timeoutMs: 1000,
      connectionStatus: "active",
      connectionConfig: { host: "10.0.0.9", port: 5432, database: "app", sslmode: "disable" },
    }),
    resolveSecret: async (_id, kind) => (kind === "basic_username" ? "reader" : "pw"),
    runQuery: async (input) => {
      calls.push({ readOnly: input.readOnly, sql: input.sql });
      return { rows: [], rowCount: 0 };
    },
  });
  return { connector, calls };
}

const context = (beforeWrite = () => {}) =>
  ({ connectionId, signal: new AbortController().signal, beforeWrite }) as never;

describe("Postgres connector read-only execution", () => {
  it("runs a published read with readOnly", async () => {
    const { connector, calls } = connectorFor("read");
    await connector.execute({ tool, operation: tool, resource: "1", args: { id: "1" } } as never, context());
    expect(calls).toEqual([{ readOnly: true, sql: expect.any(String) }]);
  });

  it("runs a published write without readOnly", async () => {
    const { connector, calls } = connectorFor("write_update");
    await connector.execute(
      { tool, operation: tool, resource: "1", args: { id: "1", note: "x" } } as never,
      context(),
    );
    expect(calls).toEqual([{ readOnly: false, sql: expect.any(String) }]);
  });
});
