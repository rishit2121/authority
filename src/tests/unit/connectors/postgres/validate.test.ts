import { describe, expect, it } from "vitest";

import { validateQueryDefinition } from "@/lib/connectors/postgres/validate";
import type { PostgresQueryInputSchema } from "@/lib/connectors/postgres/types";

const schema = (fields: PostgresQueryInputSchema["fields"]): PostgresQueryInputSchema => ({
  schemaVersion: 1,
  fields,
});

describe("validateQueryDefinition", () => {
  it("accepts a well-formed read query with one identifying field", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "select id, status from orders where customer_id = :customerId",
      effect: "read",
      inputSchema: schema([{ key: "customerId", type: "string", required: true, identifiesResource: true }]),
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a declared read that does not start with SELECT or WITH", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "update orders set status = 'shipped' where id = :orderId",
      effect: "read",
      inputSchema: schema([{ key: "orderId", type: "string", required: true, identifiesResource: true }]),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /must start with/.test(i.message))).toBe(true);
  });

  it("rejects statement stacking via a non-trailing semicolon", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "select 1; drop table orders",
      effect: "read",
      inputSchema: schema([{ key: "x", type: "string", required: false, identifiesResource: true }]),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /one statement/.test(i.message))).toBe(true);
  });

  it("allows a single trailing semicolon", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "select id from orders where id = :orderId;",
      effect: "read",
      inputSchema: schema([{ key: "orderId", type: "string", required: true, identifiesResource: true }]),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a declared read that writes through a data-modifying CTE", () => {
    // The classic trick: the statement is nominally headed by SELECT, but a
    // CTE inside it performs a DELETE. A first-token check alone would miss
    // this -- the keyword scan must cover the whole statement.
    const result = validateQueryDefinition({
      sqlTemplate:
        "with deleted as (delete from orders where id = :orderId returning *) select * from deleted",
      effect: "read",
      inputSchema: schema([{ key: "orderId", type: "string", required: true, identifiesResource: true }]),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /data-modifying or schema-changing/.test(i.message))).toBe(true);
  });

  it("rejects a declared read that writes without any CTE wrapper, if it somehow starts with WITH/SELECT text", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "select (insert into audit_log(msg) values ('x') returning 1)",
      effect: "read",
      inputSchema: schema([{ key: "x", type: "string", required: false, identifiesResource: true }]),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects DDL/permissions keywords even for a declared write", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "drop table orders",
      effect: "write_delete",
      inputSchema: schema([{ key: "x", type: "string", required: false, identifiesResource: true }]),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /Schema and permissions/.test(i.message))).toBe(true);
  });

  it("allows a declared write to use INSERT/UPDATE/DELETE", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "update orders set status = :status where id = :orderId",
      effect: "write_update",
      inputSchema: schema([
        { key: "orderId", type: "string", required: true, identifiesResource: true },
        { key: "status", type: "string", required: true, identifiesResource: false },
      ]),
    });
    expect(result.ok).toBe(true);
  });

  it("does not mistake Postgres's :: cast operator for a named parameter", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "select price::numeric from orders where id = :orderId",
      effect: "read",
      inputSchema: schema([{ key: "orderId", type: "string", required: true, identifiesResource: true }]),
    });
    expect(result.ok).toBe(true);
  });

  it("requires exactly one identifiesResource field", () => {
    const none = validateQueryDefinition({
      sqlTemplate: "select 1 from orders where id = :orderId",
      effect: "read",
      inputSchema: schema([{ key: "orderId", type: "string", required: true, identifiesResource: false }]),
    });
    expect(none.ok).toBe(false);
    expect(none.issues.some((i) => /Exactly one field/.test(i.message))).toBe(true);

    const two = validateQueryDefinition({
      sqlTemplate: "select 1 from orders where id = :a and customer_id = :b",
      effect: "read",
      inputSchema: schema([
        { key: "a", type: "string", required: true, identifiesResource: true },
        { key: "b", type: "string", required: true, identifiesResource: true },
      ]),
    });
    expect(two.ok).toBe(false);
    expect(two.issues.some((i) => /Only one field/.test(i.message))).toBe(true);
  });

  it("requires every placeholder to have a declared field, and vice versa", () => {
    const undeclared = validateQueryDefinition({
      sqlTemplate: "select 1 from orders where id = :orderId",
      effect: "read",
      inputSchema: schema([]),
    });
    expect(undeclared.ok).toBe(false);

    const unused = validateQueryDefinition({
      sqlTemplate: "select 1 from orders",
      effect: "read",
      inputSchema: schema([{ key: "orderId", type: "string", required: true, identifiesResource: true }]),
    });
    expect(unused.ok).toBe(false);
    expect(unused.issues.some((i) => /does not appear as ":orderId"/.test(i.message))).toBe(true);
  });

  it("rejects a duplicate field key", () => {
    const result = validateQueryDefinition({
      sqlTemplate: "select 1 from orders where id = :orderId",
      effect: "read",
      inputSchema: schema([
        { key: "orderId", type: "string", required: true, identifiesResource: true },
        { key: "orderId", type: "number", required: false, identifiesResource: false },
      ]),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /Duplicate field key/.test(i.message))).toBe(true);
  });
});
