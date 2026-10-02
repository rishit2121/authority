import { describe, expect, it } from "vitest";

import { buildQuery, validateArguments } from "@/lib/connectors/postgres/request-builder";
import { PostgresQueryValidationError } from "@/lib/connectors/postgres/types";

const definition = {
  sqlTemplate: "select id, status from orders where customer_id = :customerId and status = :status",
  inputSchema: {
    schemaVersion: 1 as const,
    fields: [
      { key: "customerId", type: "string" as const, required: true, identifiesResource: true },
      { key: "status", type: "string" as const, required: false, identifiesResource: false },
    ],
  },
};

describe("buildQuery", () => {
  it("converts named placeholders to positional parameters and binds values in order", () => {
    const built = buildQuery(definition, { customerId: "cust_1", status: "pending" });
    expect(built.sql).toBe("select id, status from orders where customer_id = $1 and status = $2");
    expect(built.values).toEqual(["cust_1", "pending"]);
    expect(built.resource).toBe("cust_1");
  });

  it("reuses the same positional index when a placeholder repeats", () => {
    const repeated = {
      sqlTemplate: "select 1 from orders where customer_id = :customerId or backup_customer_id = :customerId",
      inputSchema: definition.inputSchema,
    };
    const built = buildQuery(repeated, { customerId: "cust_1" });
    expect(built.sql).toBe("select 1 from orders where customer_id = $1 or backup_customer_id = $1");
    expect(built.values).toEqual(["cust_1"]);
  });

  it("never substitutes Postgres's own :: cast operator", () => {
    const withCast = {
      sqlTemplate: "select price::numeric from orders where customer_id = :customerId",
      inputSchema: {
        schemaVersion: 1 as const,
        fields: [{ key: "customerId", type: "string" as const, required: true, identifiesResource: true }],
      },
    };
    const built = buildQuery(withCast, { customerId: "cust_1" });
    expect(built.sql).toBe("select price::numeric from orders where customer_id = $1");
    expect(built.values).toEqual(["cust_1"]);
  });

  it("throws if an optional field's own placeholder is referenced in the SQL but no value was supplied", () => {
    // A ":status" placeholder in the template has no way to be "skipped" --
    // Postgres needs a bound value at that position regardless of whether
    // the field is declared optional. "required: false" only matters to the
    // plan-validator's own clarification logic (src/lib/authorization/
    // plan-validator.ts), never to whether the query can actually run.
    expect(() => buildQuery(definition, { customerId: "cust_1" })).toThrow(PostgresQueryValidationError);
  });

  it("throws on a required field missing", () => {
    expect(() => buildQuery(definition, { status: "pending" })).toThrow(PostgresQueryValidationError);
  });

  it("throws on an undeclared argument", () => {
    expect(() => validateArguments(definition, { customerId: "x", extra: "y" })).toThrow(
      PostgresQueryValidationError,
    );
  });

  it("throws on a type mismatch", () => {
    expect(() => validateArguments(definition, { customerId: 123 })).toThrow(PostgresQueryValidationError);
  });

  it("redacts a resource value that fails the gateway's clean-charset check, same as Gmail's connector", () => {
    const emailResource = {
      sqlTemplate: "select 1 from users where email = :email",
      inputSchema: {
        schemaVersion: 1 as const,
        fields: [{ key: "email", type: "string" as const, required: true, identifiesResource: true }],
      },
    };
    const built = buildQuery(emailResource, { email: "customer@example.com" });
    expect(built.resource).toMatch(/^\[redacted:[0-9a-f]+\]$/);
  });
});
