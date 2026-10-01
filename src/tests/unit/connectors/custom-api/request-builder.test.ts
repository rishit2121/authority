import { describe, expect, it } from "vitest";

import { buildRequest, validateArguments } from "@/lib/connectors/custom-api/request-builder";
import { CustomOperationValidationError, type CustomOperationDefinitionRow } from "@/lib/connectors/custom-api/types";

const lookupOrder: Pick<
  CustomOperationDefinitionRow,
  "pathTemplate" | "method" | "inputSchema" | "requestMapping" | "connectionId"
> & { baseUrl: string } = {
  connectionId: "conn-1",
  baseUrl: "https://api.example.com",
  method: "GET",
  pathTemplate: "/v1/orders/{orderId}",
  inputSchema: {
    schemaVersion: 1,
    fields: [{ key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" }],
  },
  requestMapping: { schemaVersion: 1 },
};

describe("validateArguments", () => {
  it("accepts a valid argument set", () => {
    expect(validateArguments(lookupOrder, { orderId: "4821" })).toEqual({ orderId: "4821" });
  });

  it("rejects a missing required field", () => {
    expect(() => validateArguments(lookupOrder, {})).toThrow(CustomOperationValidationError);
  });

  it("rejects an undeclared argument", () => {
    expect(() => validateArguments(lookupOrder, { orderId: "1", extra: "x" })).toThrow(/not a declared argument/);
  });

  it("rejects the wrong type", () => {
    expect(() => validateArguments(lookupOrder, { orderId: 123 })).toThrow(/must be a string/);
  });
});

describe("buildRequest", () => {
  it("builds the allowed request for order #4821", () => {
    const built = buildRequest(lookupOrder, { orderId: "4821" });
    expect(built.url).toBe("https://api.example.com/v1/orders/4821");
    expect(built.method).toBe("GET");
    expect(built.resource).toBe("4821");
    expect(built.body).toBeUndefined();
  });

  it("never lets a path argument escape its own segment (the blocked request)", () => {
    for (const malicious of ["../secret", "4821/../../etc/passwd", "a/b", "..%2f..%2fetc%2fpasswd", "%2e%2e%2f"]) {
      expect(() => buildRequest(lookupOrder, { orderId: malicious })).toThrow(/PATH_TRAVERSAL|path separator|encoded separator/);
    }
  });

  it("never authorizes a different order than the one named", () => {
    const built = buildRequest(lookupOrder, { orderId: "4821" });
    expect(built.url).not.toContain("9999");
    expect(built.resource).not.toBe("9999");
  });

  it("places query fields in the query string, not the path", () => {
    const withQuery = {
      ...lookupOrder,
      pathTemplate: "/v1/orders",
      inputSchema: {
        schemaVersion: 1 as const,
        fields: [
          { key: "status", type: "string" as const, required: false, identifiesResource: true, in: "query" as const },
        ],
      },
    };
    const built = buildRequest(withQuery, { status: "refunded" });
    expect(built.url).toBe("https://api.example.com/v1/orders?status=refunded");
  });

  it("places body fields as a JSON body and sets content-type", () => {
    const cancelOrder = {
      ...lookupOrder,
      method: "POST" as const,
      pathTemplate: "/v1/orders/{orderId}/cancel",
      inputSchema: {
        schemaVersion: 1 as const,
        fields: [
          { key: "orderId", type: "string" as const, required: true, identifiesResource: true, in: "path" as const },
          { key: "reason", type: "string" as const, required: false, identifiesResource: false, in: "body" as const },
        ],
      },
    };
    const built = buildRequest(cancelOrder, { orderId: "4821", reason: "customer request" });
    expect(built.body).toBe(JSON.stringify({ reason: "customer request" }));
    expect(built.headers["content-type"]).toBe("application/json");
  });

  it("rejects a static header that is transport-sensitive or the auth header itself", () => {
    const withBadHeader = {
      ...lookupOrder,
      requestMapping: { schemaVersion: 1 as const, staticHeaders: [{ name: "Host", value: "evil.example" }] },
    };
    expect(() => buildRequest(withBadHeader, { orderId: "1" })).toThrow(/cannot be set by a static header/);

    const withAuthOverride = {
      ...lookupOrder,
      requestMapping: { schemaVersion: 1 as const, staticHeaders: [{ name: "Authorization", value: "Bearer evil" }] },
    };
    expect(() => buildRequest(withAuthOverride, { orderId: "1" })).toThrow(/cannot be set by a static header/);
  });

  it("throws if no field is marked identifiesResource", () => {
    const misconfigured = {
      ...lookupOrder,
      inputSchema: {
        schemaVersion: 1 as const,
        fields: [{ key: "orderId", type: "string" as const, required: true, identifiesResource: false, in: "path" as const }],
      },
    };
    expect(() => buildRequest(misconfigured, { orderId: "1" })).toThrow(/identifiesResource/);
  });
});
