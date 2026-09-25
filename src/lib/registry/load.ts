import "server-only";

import { registrySchema, type Permission, type RegistryData, type ToolOperation } from "./types";

/**
 * Loads and validates a registry fixture.
 *
 * "Validate" here means structural, mechanical checks derivable from the
 * registry's own data — never name inspection, never an LLM. A registry that
 * fails any of these checks is a defect in the audited fixture itself, not a
 * runtime condition any caller can trigger, so this throws rather than
 * returning a typed error: nothing downstream should ever run against a
 * malformed registry.
 */
export class RegistryValidationError extends Error {}

export interface LoadedRegistry {
  registryVersion: string;
  operations: Map<string, ToolOperation>;
  permissions: Map<string, Permission>;
  /** Operation ID -> every permission ID that authorizes it, derived once at load time. */
  operationCoverage: Map<string, string[]>;
}

export function loadRegistry(data: RegistryData): LoadedRegistry {
  const parsed = registrySchema.parse(data);

  const operations = new Map<string, ToolOperation>();
  for (const op of parsed.operations) {
    if (operations.has(op.id)) {
      throw new RegistryValidationError(`duplicate operation id in registry: ${op.id}`);
    }
    operations.set(op.id, op);
  }

  const permissions = new Map<string, Permission>();
  for (const permission of parsed.permissions) {
    if (permissions.has(permission.id)) {
      throw new RegistryValidationError(`duplicate permission id in registry: ${permission.id}`);
    }
    for (const opId of permission.operations) {
      if (!operations.has(opId)) {
        throw new RegistryValidationError(`permission ${permission.id} references unknown operation ${opId}`);
      }
    }
    permissions.set(permission.id, permission);
  }

  const operationCoverage = new Map<string, string[]>();
  for (const opId of operations.keys()) operationCoverage.set(opId, []);
  for (const permission of permissions.values()) {
    for (const opId of permission.operations) {
      operationCoverage.get(opId)!.push(permission.id);
    }
  }
  // Deterministic ordering wherever a coverage list is consulted.
  for (const list of operationCoverage.values()) list.sort();

  const uncovered = [...operationCoverage.entries()].filter(([, ids]) => ids.length === 0);
  if (uncovered.length > 0) {
    throw new RegistryValidationError(
      `registry operation(s) with no covering permission: ${uncovered.map(([id]) => id).join(", ")}`,
    );
  }

  return { registryVersion: parsed.registryVersion, operations, permissions, operationCoverage };
}
