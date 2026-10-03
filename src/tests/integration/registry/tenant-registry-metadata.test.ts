import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeGatewayPool } from "@/lib/gateway/db";
import { buildTenantRegistry } from "@/lib/registry";

import {
  ADMIN_A_USER_ID,
  createCustomApiConnection,
  publishOperation,
  type CustomApiConnectionFixture,
  type PublishedOperationFixture,
} from "../connectors/custom-api-support";
import {
  createPostgresConnection,
  publishQuery,
  type PostgresConnectionFixture,
  type PublishedQueryFixture,
} from "../connectors/postgres-support";
import { TENANT_A_ID } from "../support";

/**
 * Regression for a real, investigated inaccuracy (not the same bug class as
 * the empty-list/empty-policies ones elsewhere in this session): every
 * tenant-published operation, Postgres or Custom API, read or write, was
 * unconditionally marked `externalCommunication: true` in
 * registry/tenant.ts -- conflating "this operation targets a system outside
 * this process" with "this operation discloses information to one," which
 * is what externalCommunication is actually meant to capture (the
 * established paradigm case is gmail.send_email; see plan-validator.ts's
 * own comment: "communicates outside the organization").
 *
 * A Postgres connection targets the TENANT'S OWN database -- never a third
 * party, regardless of effect. A Custom API connection does target a real
 * third-party endpoint, but only a write's request body/params are actually
 * sent to it; a read's response only flows in, disclosing nothing.
 *
 * This fix does NOT exempt any read from approval: dataSensitivity stays
 * "confidential" by default for every tenant-published operation (the
 * registry genuinely cannot vouch for an operator-configured destination's
 * actual sensitivity), which independently and unconditionally requires
 * security_admin approval via approval-rules.ts's HIGH_SENSITIVITY rule --
 * unchanged by this fix, verified below.
 */

describe("buildTenantRegistry — tenant-published operation metadata", () => {
  let pgConnection: PostgresConnectionFixture;
  let pgRead: PublishedQueryFixture;
  let pgWrite: PublishedQueryFixture;
  let apiConnection: CustomApiConnectionFixture;
  let apiRead: PublishedOperationFixture;
  let apiWrite: PublishedOperationFixture;

  beforeAll(async () => {
    pgConnection = await createPostgresConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "registry-metadata-pg",
    });
    pgRead = await publishQuery(pgConnection, {
      querySlug: "get_widget",
      name: "Get widget",
      sqlTemplate: "select id from widgets where id = :widgetId",
      effect: "read",
      inputSchema: {
        schemaVersion: 1,
        fields: [{ key: "widgetId", type: "string", required: true, identifiesResource: true }],
      },
    });
    pgWrite = await publishQuery(pgConnection, {
      querySlug: "rename_widget",
      name: "Rename widget",
      sqlTemplate: "update widgets set name = :name where id = :widgetId",
      effect: "write_update",
      inputSchema: {
        schemaVersion: 1,
        fields: [
          { key: "widgetId", type: "string", required: true, identifiesResource: true },
          { key: "name", type: "string", required: true, identifiesResource: false },
        ],
      },
    });

    apiConnection = await createCustomApiConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "registry-metadata-api",
    });
    apiRead = await publishOperation(apiConnection, {
      operationSlug: "get_widget",
      name: "Get widget",
      method: "GET",
      pathTemplate: "/v1/widgets/{widgetId}",
      effect: "read",
      inputSchema: {
        schemaVersion: 1,
        fields: [{ key: "widgetId", type: "string", required: true, identifiesResource: true, in: "path" }],
      },
    });
    apiWrite = await publishOperation(apiConnection, {
      operationSlug: "rename_widget",
      name: "Rename widget",
      method: "POST",
      pathTemplate: "/v1/widgets/{widgetId}/rename",
      effect: "write_update",
      inputSchema: {
        schemaVersion: 1,
        fields: [{ key: "widgetId", type: "string", required: true, identifiesResource: true, in: "path" }],
      },
    });
  }, 60_000);

  afterAll(async () => {
    await pgConnection?.cleanup();
    await apiConnection?.cleanup();
    await closeGatewayPool();
  }, 30_000);

  it("never marks a Postgres operation externalCommunication, read or write -- it targets the tenant's own database", async () => {
    const registry = await buildTenantRegistry(TENANT_A_ID);
    expect(registry.operations.get(pgRead.toolName)?.externalCommunication).toBe(false);
    expect(registry.operations.get(pgWrite.toolName)?.externalCommunication).toBe(false);
  });

  it("marks a Custom API write, but not a read, externalCommunication -- only a write actually sends anything to the third party", async () => {
    const registry = await buildTenantRegistry(TENANT_A_ID);
    expect(registry.operations.get(apiRead.toolName)?.externalCommunication).toBe(false);
    expect(registry.operations.get(apiWrite.toolName)?.externalCommunication).toBe(true);
  });

  it("still conservatively marks every tenant-published operation confidential -- this fix never exempts a read from approval", async () => {
    const registry = await buildTenantRegistry(TENANT_A_ID);
    for (const tool of [pgRead, pgWrite, apiRead, apiWrite]) {
      expect(registry.operations.get(tool.toolName)?.dataSensitivity).toBe("confidential");
    }
  });
});
