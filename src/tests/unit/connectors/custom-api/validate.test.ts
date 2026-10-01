import { describe, expect, it } from "vitest";

import { validateOperationDefinition } from "@/lib/connectors/custom-api/validate";
import type { CustomOperationField, CustomOperationInputSchema, CustomOperationRequestMapping } from "@/lib/connectors/custom-api/types";

const schema = (fields: CustomOperationField[]): CustomOperationInputSchema => ({ schemaVersion: 1, fields });
const mapping = (over: Partial<CustomOperationRequestMapping> = {}): CustomOperationRequestMapping => ({ schemaVersion: 1, ...over });

const orderIdField: CustomOperationField = { key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" };

describe("validateOperationDefinition", () => {
  it("accepts a well-formed single-field operation", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}",
      inputSchema: schema([orderIdField]),
      requestMapping: mapping(),
    });
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("accepts a well-formed multi-field operation spanning path, query, and body", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}/items",
      inputSchema: schema([
        orderIdField,
        { key: "status", type: "string", required: false, identifiesResource: false, in: "query" },
        { key: "note", type: "string", required: false, identifiesResource: false, in: "body" },
        { key: "quantity", type: "number", required: true, identifiesResource: false, in: "body" },
      ]),
      requestMapping: mapping(),
    });
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("rejects a path template that doesn't start with /", () => {
    const result = validateOperationDefinition({
      pathTemplate: "v1/orders/{orderId}",
      inputSchema: schema([orderIdField]),
      requestMapping: mapping(),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "pathTemplate")).toBe(true);
  });

  it("rejects traversal and double-slash in the path template", () => {
    for (const path of ["/v1/../secret", "/v1//orders/{orderId}"]) {
      const result = validateOperationDefinition({
        pathTemplate: path,
        inputSchema: schema([orderIdField]),
        requestMapping: mapping(),
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects zero fields", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders",
      inputSchema: schema([]),
      requestMapping: mapping(),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects more than the maximum number of fields", () => {
    const fields: CustomOperationField[] = [orderIdField];
    for (let i = 0; i < 25; i++) {
      fields.push({ key: `field${i}`, type: "string", required: false, identifiesResource: false, in: "query" });
    }
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}",
      inputSchema: schema(fields),
      requestMapping: mapping(),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /at most/i.test(i.message))).toBe(true);
  });

  it("rejects duplicate field keys", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}",
      inputSchema: schema([orderIdField, { ...orderIdField, identifiesResource: false }]),
      requestMapping: mapping(),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /duplicate/i.test(i.message))).toBe(true);
  });

  it("rejects a malformed field key", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders/{9bad}",
      inputSchema: schema([{ key: "9bad", type: "string", required: true, identifiesResource: true, in: "path" }]),
      requestMapping: mapping(),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects zero or more than one identifiesResource field", () => {
    const none = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}",
      inputSchema: schema([{ ...orderIdField, identifiesResource: false }]),
      requestMapping: mapping(),
    });
    expect(none.ok).toBe(false);
    expect(none.issues.some((i) => /exactly one/i.test(i.message))).toBe(true);

    const two = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}",
      inputSchema: schema([
        orderIdField,
        { key: "secondary", type: "string", required: false, identifiesResource: true, in: "query" },
      ]),
      requestMapping: mapping(),
    });
    expect(two.ok).toBe(false);
    expect(two.issues.some((i) => /only one/i.test(i.message))).toBe(true);
  });

  it("rejects a path placeholder with no matching declared field", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}/{missing}",
      inputSchema: schema([orderIdField]),
      requestMapping: mapping(),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /missing.*no matching/i.test(i.message))).toBe(true);
  });

  it("rejects a path-located field that names no placeholder", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders",
      inputSchema: schema([{ key: "orphan", type: "string", required: true, identifiesResource: true, in: "path" }]),
      requestMapping: mapping(),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /does not appear in the path template/i.test(i.message))).toBe(true);
  });

  it("rejects an optional path field", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}",
      inputSchema: schema([{ ...orderIdField, required: false }]),
      requestMapping: mapping(),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a forbidden static header", () => {
    const result = validateOperationDefinition({
      pathTemplate: "/v1/orders/{orderId}",
      inputSchema: schema([orderIdField]),
      requestMapping: mapping({ staticHeaders: [{ name: "Authorization", value: "Bearer x" }] }),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /cannot be set by a static header/i.test(i.message))).toBe(true);
  });
});
