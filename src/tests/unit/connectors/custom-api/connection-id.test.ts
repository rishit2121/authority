import { describe, expect, it } from "vitest";

import {
  connectionIdFromCustomApiConnectorId,
  toCustomApiConnectorId,
} from "@/lib/connectors/custom-api/connection-id";

describe("custom API connector id encoding", () => {
  it("round-trips a UUID through the connector id", () => {
    const id = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
    const connectorId = toCustomApiConnectorId(id);
    expect(connectorId).toBe("custom_a1b2c3d4e5f64789a0123456789abcde");
    expect(connectionIdFromCustomApiConnectorId(connectorId)).toBe(id);
  });

  it("rejects a non-UUID input to the encoder", () => {
    expect(() => toCustomApiConnectorId("not-a-uuid")).toThrow();
  });

  it("returns null for a connector id without the custom_ prefix", () => {
    expect(connectionIdFromCustomApiConnectorId("stripe")).toBeNull();
  });

  it("returns null for a malformed hex suffix", () => {
    expect(connectionIdFromCustomApiConnectorId("custom_nothex")).toBeNull();
    expect(connectionIdFromCustomApiConnectorId("custom_" + "a".repeat(31))).toBeNull();
  });
});
