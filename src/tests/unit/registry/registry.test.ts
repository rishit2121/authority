import { describe, expect, it } from "vitest";

import {
  buildPermissionHierarchy,
  githubDemoRegistry,
  loadRegistry,
  RegistryValidationError,
} from "@/lib/registry";

describe("loadRegistry", () => {
  it("loads the audited demo registry without error", () => {
    const loaded = loadRegistry(githubDemoRegistry);
    expect(loaded.registryVersion).toBe("github-demo-2026-09-30");
    expect(loaded.operations.size).toBe(11);
    expect(loaded.permissions.size).toBe(15);
  });

  it("computes deterministic, sorted coverage per operation", () => {
    const loaded = loadRegistry(githubDemoRegistry);
    expect(loaded.operationCoverage.get("github.get_issue")).toEqual([
      "github.issues_read",
      "github.issues_read_alt",
      "github.repo_admin",
      "github.repo_read",
    ]);
  });

  it("rejects a duplicate permission id", () => {
    const malformed = {
      ...githubDemoRegistry,
      permissions: [...githubDemoRegistry.permissions, githubDemoRegistry.permissions[0]],
    };
    expect(() => loadRegistry(malformed)).toThrow(RegistryValidationError);
  });

  it("rejects a duplicate operation id", () => {
    const malformed = {
      ...githubDemoRegistry,
      operations: [...githubDemoRegistry.operations, githubDemoRegistry.operations[0]],
    };
    expect(() => loadRegistry(malformed)).toThrow(RegistryValidationError);
  });

  it("rejects a permission referencing an unknown operation", () => {
    const malformed = {
      ...githubDemoRegistry,
      permissions: [
        ...githubDemoRegistry.permissions,
        {
          id: "github.bogus",
          provider: "github",
          operations: ["github.does_not_exist"],
          classification: "read" as const,
          riskCost: 1,
          resourceBreadth: 1,
          allowsExternalCommunication: false,
        },
      ],
    };
    expect(() => loadRegistry(malformed)).toThrow(RegistryValidationError);
  });

  it("rejects an operation with zero covering permissions", () => {
    const malformed = {
      ...githubDemoRegistry,
      operations: [
        ...githubDemoRegistry.operations,
        {
          id: "github.orphan_operation",
          provider: "github",
          sideEffect: "read" as const,
          resourceType: "issue",
          dataSensitivity: "internal" as const,
          externalCommunication: false,
          requiresApproval: false,
          financialImpact: false,
          argumentFields: [],
          preconditions: [],
          effects: [],
          alternativeOperationIds: [],
        },
      ],
    };
    expect(() => loadRegistry(malformed)).toThrow(RegistryValidationError);
  });
});

describe("buildPermissionHierarchy", () => {
  const loaded = loadRegistry(githubDemoRegistry);
  const hierarchy = buildPermissionHierarchy([...loaded.permissions.values()]);

  it("finds a strict-subset (narrower) edge", () => {
    expect(hierarchy.edges).toContainEqual({
      narrowerId: "github.issues_read",
      broaderId: "github.repo_read",
    });
  });

  it("finds a multi-operation narrower/broader edge", () => {
    expect(hierarchy.edges).toContainEqual({
      narrowerId: "github.branches_write",
      broaderId: "github.contents_write",
    });
  });

  it("does not create an edge between incomparable permissions", () => {
    const hasEdge = hierarchy.edges.some(
      (e) =>
        (e.narrowerId === "github.issues_read" && e.broaderId === "github.commits_write") ||
        (e.narrowerId === "github.commits_write" && e.broaderId === "github.issues_read"),
    );
    expect(hasEdge).toBe(false);
  });

  it("groups identical operation sets as equivalent, not narrower/broader", () => {
    expect(hierarchy.equivalentGroups.get("github.issues_read")).toEqual(["github.issues_read_alt"]);
    expect(hierarchy.equivalentGroups.get("github.issues_read_alt")).toEqual(["github.issues_read"]);
    const hasSelfEdge = hierarchy.edges.some(
      (e) => e.narrowerId === "github.issues_read" && e.broaderId === "github.issues_read_alt",
    );
    expect(hasSelfEdge).toBe(false);
  });

  it("produces edges in deterministic sorted order across repeated runs", () => {
    const again = buildPermissionHierarchy([...loaded.permissions.values()].reverse());
    expect(again.edges).toEqual(hierarchy.edges);
  });

  it("handles multiple disconnected hierarchies without assuming connectivity", () => {
    // secrets_read has no narrower/broader relationship to the issues/repo family at all.
    const involvesSecrets = hierarchy.edges.filter(
      (e) => e.narrowerId === "github.secrets_read" || e.broaderId === "github.secrets_read",
    );
    // The only permission broader than secrets_read is repo_admin, which subsumes everything.
    expect(involvesSecrets).toEqual([{ narrowerId: "github.secrets_read", broaderId: "github.repo_admin" }]);
  });
});
