import "server-only";

import { createHash } from "node:crypto";

import { REST_CONNECTOR_SPECS } from "@/lib/connectors/rest/providers";
import { restRegistryParts } from "@/lib/connectors/rest/registry";
import { parseSpec } from "@/lib/connectors/rest/request";

import type { RegistryData } from "../types";

import { githubDemoRegistry } from "./github-demo";

/**
 * The registry version every tenant starts from. Authorize compares a contract's registry version exactly, so a
 * change here retires every active contract until its task is re-prepared: bump it deliberately (date + letter)
 * whenever BASE_REGISTRY_FINGERPRINT changes. Read by src/tests/integration/gateway-support.ts.
 */
export const BASE_REGISTRY_VERSION = "base-2026-11-17a";

/** sha256 (first 16 hex) of the hand-written registry version plus the generated REST operations/permissions. */
export const BASE_REGISTRY_FINGERPRINT = "21ac08d9e35741f3";

const rest = restRegistryParts(REST_CONNECTOR_SPECS.map(parseSpec));

/** What BASE_REGISTRY_FINGERPRINT must equal; registry-base.test.ts fails when they differ. */
export function computeBaseRegistryFingerprint(): string {
  return createHash("sha256")
    .update(JSON.stringify({ handWritten: githubDemoRegistry.registryVersion, rest }))
    .digest("hex")
    .slice(0, 16);
}

/**
 * The registry every tenant starts from: the audited hand-written operations (github-demo.ts) plus the operations
 * generated from the declarative REST connector specs (src/lib/connectors/rest).
 */
export const baseRegistry: RegistryData = {
  schemaVersion: 1,
  registryVersion: BASE_REGISTRY_VERSION,
  operations: [...githubDemoRegistry.operations, ...rest.operations],
  permissions: [...githubDemoRegistry.permissions, ...rest.permissions],
};
