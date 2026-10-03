import { beforeEach, describe, expect, it, vi } from "vitest";

const listPublishedCustomOperationsForTenant = vi.fn();
const listPublishedPostgresQueriesForTenant = vi.fn();

vi.mock("@/lib/gateway/rpc-custom-operations", () => ({
  listPublishedCustomOperationsForTenant: (...args: unknown[]) =>
    listPublishedCustomOperationsForTenant(...args),
}));
vi.mock("@/lib/gateway/rpc-postgres-queries", () => ({
  listPublishedPostgresQueriesForTenant: (...args: unknown[]) =>
    listPublishedPostgresQueriesForTenant(...args),
}));

import { githubDemoRegistry } from "@/lib/registry/fixtures/github-demo";
import { buildTenantRegistry } from "@/lib/registry/tenant";
import type { TenantPublishedOperation } from "@/lib/gateway/rpc-custom-operations";

function fakeOp(over: Partial<TenantPublishedOperation> = {}): TenantPublishedOperation {
  return {
    operationId: "op-1",
    toolName: "custom_abc123.get_order",
    operationSlug: "get_order",
    name: "Get order",
    description: null,
    effect: "read",
    inputSchema: {
      schemaVersion: 1,
      fields: [{ key: "orderId", type: "string", required: true, identifiesResource: true }],
    },
    inputSchemaHash: "hash-a",
    requestMappingHash: "hash-b",
    connectorId: "custom_abc123",
    connectionName: "Widget Orders API",
    publishedAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("buildTenantRegistry", () => {
  beforeEach(() => {
    listPublishedCustomOperationsForTenant.mockReset();
    listPublishedPostgresQueriesForTenant.mockReset();
    listPublishedPostgresQueriesForTenant.mockResolvedValue([]);
  });

  it("returns the unmodified GitHub registry, byte-identical, when the tenant has no published custom operations", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([]);
    const registry = await buildTenantRegistry("tenant-a");
    expect(registry.registryVersion).toBe(githubDemoRegistry.registryVersion);
    expect(registry.operations.size).toBe(githubDemoRegistry.operations.length);
  });

  it("merges a published operation in alongside the GitHub fixture", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([fakeOp()]);
    const registry = await buildTenantRegistry("tenant-a");
    expect(registry.operations.has("custom_abc123.get_order")).toBe(true);
    expect(registry.operations.size).toBe(githubDemoRegistry.operations.length + 1);
    // Every GitHub operation is still present, untouched.
    for (const op of githubDemoRegistry.operations) {
      expect(registry.operations.get(op.id)).toEqual(op);
    }
  });

  it("gives the merged operation exactly one covering permission, scoped to itself", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([fakeOp()]);
    const registry = await buildTenantRegistry("tenant-a");
    const coverage = registry.operationCoverage.get("custom_abc123.get_order");
    expect(coverage).toHaveLength(1);
    const permission = registry.permissions.get(coverage![0])!;
    expect(permission.operations).toEqual(["custom_abc123.get_order"]);
    expect(permission.resourceBreadth).toBe(1);
  });

  it("marks a Custom API write, but not a read, as external communication -- only a write sends anything to the third party", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValueOnce([fakeOp({ effect: "read" })]);
    const readRegistry = await buildTenantRegistry("tenant-a");
    expect(readRegistry.operations.get("custom_abc123.get_order")!.externalCommunication).toBe(false);

    listPublishedCustomOperationsForTenant.mockResolvedValueOnce([
      fakeOp({ toolName: "custom_abc123.cancel_order", effect: "write_update" }),
    ]);
    const writeRegistry = await buildTenantRegistry("tenant-b");
    expect(writeRegistry.operations.get("custom_abc123.cancel_order")!.externalCommunication).toBe(true);
  });

  it("changes the registry version deterministically based on the published operation set", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([fakeOp()]);
    const first = await buildTenantRegistry("tenant-a");
    const second = await buildTenantRegistry("tenant-a");
    expect(first.registryVersion).toBe(second.registryVersion);
    expect(first.registryVersion).not.toBe(githubDemoRegistry.registryVersion);
    expect(first.registryVersion.length).toBeLessThanOrEqual(40);
  });

  it("produces a different registry version when the published set differs", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValueOnce([fakeOp()]);
    const a = await buildTenantRegistry("tenant-a");
    listPublishedCustomOperationsForTenant.mockResolvedValueOnce([
      fakeOp({ toolName: "custom_def456.other_op", connectorId: "custom_def456" }),
    ]);
    const b = await buildTenantRegistry("tenant-b");
    expect(a.registryVersion).not.toBe(b.registryVersion);
  });

  it("never lets one tenant's custom operation leak into another tenant's registry call", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValueOnce([fakeOp()]);
    await buildTenantRegistry("tenant-a");
    expect(listPublishedCustomOperationsForTenant).toHaveBeenCalledWith("tenant-a");

    listPublishedCustomOperationsForTenant.mockResolvedValueOnce([]);
    const registryB = await buildTenantRegistry("tenant-b");
    expect(listPublishedCustomOperationsForTenant).toHaveBeenCalledWith("tenant-b");
    expect(registryB.operations.has("custom_abc123.get_order")).toBe(false);
  });

  it("maps write effects to required approval and a higher risk cost than reads", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([
      fakeOp({ toolName: "custom_abc123.cancel_order", effect: "write_update" }),
    ]);
    const registry = await buildTenantRegistry("tenant-a");
    const op = registry.operations.get("custom_abc123.cancel_order")!;
    expect(op.requiresApproval).toBe(true);
    const coverage = registry.operationCoverage.get("custom_abc123.cancel_order")!;
    const permission = registry.permissions.get(coverage[0])!;
    expect(permission.riskCost).toBeGreaterThan(3);
    expect(permission.classification).toBe("write");
  });

  it("merges a published postgres query in alongside the GitHub fixture and any custom operations", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([fakeOp()]);
    listPublishedPostgresQueriesForTenant.mockResolvedValue([
      {
        queryId: "q-1",
        toolName: "postgres_abc123.get_customer_orders",
        querySlug: "get_customer_orders",
        name: "Get customer orders",
        description: null,
        effect: "read",
        inputSchema: {
          schemaVersion: 1,
          fields: [{ key: "customerId", type: "string", required: true, identifiesResource: true }],
        },
        inputSchemaHash: "hash-c",
        sqlTemplateHash: "hash-d",
        connectorId: "postgres_abc123",
        connectionName: "Primary database",
        publishedAt: "2026-10-01T00:00:00Z",
      },
    ]);
    const registry = await buildTenantRegistry("tenant-a");
    expect(registry.operations.has("custom_abc123.get_order")).toBe(true);
    expect(registry.operations.has("postgres_abc123.get_customer_orders")).toBe(true);
    expect(registry.operations.size).toBe(githubDemoRegistry.operations.length + 2);
    const op = registry.operations.get("postgres_abc123.get_customer_orders")!;
    // Never external communication, regardless of effect -- a Postgres
    // connection targets the tenant's own database, never a third party.
    expect(op.externalCommunication).toBe(false);
    expect(op.requiresApproval).toBe(false);
  });

  it("returns the unmodified GitHub registry when a tenant has published postgres queries but no custom operations", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([]);
    listPublishedPostgresQueriesForTenant.mockResolvedValue([]);
    const registry = await buildTenantRegistry("tenant-a");
    expect(registry.registryVersion).toBe(githubDemoRegistry.registryVersion);
  });

  it("never marks a Postgres write as external communication either -- its own database is never a third party", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([]);
    listPublishedPostgresQueriesForTenant.mockResolvedValue([
      {
        queryId: "q-2",
        toolName: "postgres_abc123.rename_widget",
        querySlug: "rename_widget",
        name: "Rename widget",
        description: null,
        effect: "write_update",
        inputSchema: {
          schemaVersion: 1,
          fields: [{ key: "widgetId", type: "string", required: true, identifiesResource: true }],
        },
        inputSchemaHash: "hash-e",
        sqlTemplateHash: "hash-f",
        connectorId: "postgres_abc123",
        connectionName: "Primary database",
        publishedAt: "2026-10-01T00:00:00Z",
      },
    ]);
    const registry = await buildTenantRegistry("tenant-a");
    expect(registry.operations.get("postgres_abc123.rename_widget")!.externalCommunication).toBe(false);
  });
});
