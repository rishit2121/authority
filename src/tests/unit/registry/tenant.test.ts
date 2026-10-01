import { beforeEach, describe, expect, it, vi } from "vitest";

const listPublishedCustomOperationsForTenant = vi.fn();

vi.mock("@/lib/gateway/rpc-custom-operations", () => ({
  listPublishedCustomOperationsForTenant: (...args: unknown[]) => listPublishedCustomOperationsForTenant(...args),
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

  it("marks every custom operation as external communication, forcing mandatory review regardless of effect", async () => {
    listPublishedCustomOperationsForTenant.mockResolvedValue([fakeOp({ effect: "read" })]);
    const registry = await buildTenantRegistry("tenant-a");
    expect(registry.operations.get("custom_abc123.get_order")!.externalCommunication).toBe(true);
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
    listPublishedCustomOperationsForTenant.mockResolvedValueOnce([fakeOp({ toolName: "custom_def456.other_op", connectorId: "custom_def456" })]);
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
});
