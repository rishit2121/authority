import { describe, expect, it } from "vitest";

import { loadRegistry } from "@/lib/registry";
import {
  BASE_REGISTRY_FINGERPRINT,
  BASE_REGISTRY_VERSION,
  baseRegistry,
  computeBaseRegistryFingerprint,
} from "@/lib/registry/fixtures/base";
import { githubDemoRegistry } from "@/lib/registry/fixtures/github-demo";

describe("base registry (hand-written + declarative REST connectors)", () => {
  it("loads, and keeps every hand-written operation and permission unchanged", () => {
    const loaded = loadRegistry(baseRegistry);
    for (const op of githubDemoRegistry.operations) expect(loaded.operations.get(op.id)).toEqual(op);
    expect(baseRegistry.permissions.slice(0, githubDemoRegistry.permissions.length)).toEqual(
      githubDemoRegistry.permissions,
    );
  });

  it("changes version whenever its content changes (authorize compares versions exactly)", () => {
    // If this fails: a spec or the hand-written registry changed. Bump BASE_REGISTRY_VERSION (date + letter) and set
    // BASE_REGISTRY_FINGERPRINT to the computed value. Active contracts must then be re-prepared.
    expect({ version: BASE_REGISTRY_VERSION, fingerprint: computeBaseRegistryFingerprint() }).toEqual({
      version: BASE_REGISTRY_VERSION,
      fingerprint: BASE_REGISTRY_FINGERPRINT,
    });
  });

  it("leaves room for a tenant suffix within the 40-character version limit", () => {
    expect(`${BASE_REGISTRY_VERSION}+c12345678`.length).toBeLessThanOrEqual(40);
  });
});
