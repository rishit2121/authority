import { afterEach, describe, expect, it } from "vitest";

import {
  listRegisteredConnectors,
  registerConnector,
  resetConnectorRegistryForTests,
  resolveConnectorForTool,
  type AuthorityConnector,
} from "@/lib/connectors";

function fakeConnector(id: string): AuthorityConnector {
  return {
    id,
    describeOperations: () => [],
    verifyInstallation: async () => ({ status: "active", reasons: [], lastVerifiedAt: null }),
    normalizeRequest: async (operation, input) => ({
      tool: `${id}.${operation}`,
      operation,
      resource: "",
      args: (input as Record<string, unknown>) ?? {},
    }),
    execute: async () => {
      throw new Error("not implemented in fake");
    },
    reconcile: async () => ({ outcome: "still_unknown", detail: "fake" }),
  };
}

describe("connector registry", () => {
  afterEach(() => {
    resetConnectorRegistryForTests();
  });

  it("resolves a connector by a tool's provider prefix", () => {
    registerConnector(fakeConnector("stripe"));
    const resolved = resolveConnectorForTool("stripe.retrieve_payment");
    expect(resolved?.id).toBe("stripe");
  });

  it("returns null for an unregistered provider", () => {
    expect(resolveConnectorForTool("unknown_provider.some_op")).toBeNull();
  });

  it("returns null for a malformed tool name (no action segment, or empty provider)", () => {
    expect(resolveConnectorForTool("noaction")).toBeNull();
    expect(resolveConnectorForTool(".action")).toBeNull();
  });

  it("refuses to register the same connector id twice", () => {
    registerConnector(fakeConnector("github"));
    expect(() => registerConnector(fakeConnector("github"))).toThrow(/already registered/);
  });

  it("lists every registered connector", () => {
    registerConnector(fakeConnector("stripe"));
    registerConnector(fakeConnector("slack"));
    expect(
      listRegisteredConnectors()
        .map((c) => c.id)
        .sort(),
    ).toEqual(["slack", "stripe"]);
  });
});
