import type { Permission, RegistryData, ToolOperation } from "@/lib/registry/types";

import type { ParsedRestConnectorSpec } from "./spec";

/**
 * Registry entries generated from declarative REST specs, so the operations Authority authorizes are exactly the
 * ones the generic connector can send.
 *
 * Permissions: one read permission per provider covering all of its reads, and one permission per write, so a task
 * that needs one write is never granted another. Costs follow the hand-written connectors: reads 1, ordinary writes
 * 2, writes that reach people outside the organization 3, money movement and deletes 4.
 */

export function toolOperationsFor(spec: ParsedRestConnectorSpec): ToolOperation[] {
  return spec.operations.map((op) => ({
    id: `${spec.id}.${op.slug}`,
    provider: spec.id,
    sideEffect: op.sideEffect,
    resourceType: op.resourceType,
    dataSensitivity: op.dataSensitivity,
    requiresApproval: false,
    externalCommunication: op.externalCommunication,
    financialImpact: op.financialImpact,
    argumentFields: op.args.map((a) => ({
      key: a.key,
      type: a.type,
      required: a.required,
      identifiesResource: a.key === op.resource,
      ...(a.freeText ? { freeText: true } : {}),
    })),
    preconditions:
      op.resource === undefined
        ? []
        : [
            `The ${op.resourceType.replace(/_/g, " ")} must be identifiable from the task's own intent or trusted inputs.`,
          ],
    effects: [op.summary],
    alternativeOperationIds: [],
  }));
}

export function permissionsFor(spec: ParsedRestConnectorSpec): Permission[] {
  const reads = spec.operations.filter((op) => op.sideEffect === "read");
  const permissions: Permission[] = [];
  if (reads.length > 0) {
    permissions.push({
      id: `${spec.id}.read`,
      provider: spec.id,
      operations: reads.map((op) => `${spec.id}.${op.slug}`),
      classification: "read",
      riskCost: reads.some((op) => op.dataSensitivity === "confidential" || op.dataSensitivity === "secret")
        ? 2
        : 1,
      resourceBreadth: 2,
      allowsExternalCommunication: false,
    });
  }
  for (const op of spec.operations) {
    if (op.sideEffect === "read") continue;
    permissions.push({
      id: `${spec.id}.${op.slug}`,
      provider: spec.id,
      operations: [`${spec.id}.${op.slug}`],
      classification: "write",
      riskCost: op.financialImpact || op.sideEffect === "write_delete" ? 4 : op.externalCommunication ? 3 : 2,
      resourceBreadth: 1,
      allowsExternalCommunication: op.externalCommunication,
    });
  }
  return permissions;
}

export function restRegistryParts(
  specs: ParsedRestConnectorSpec[],
): Pick<RegistryData, "operations" | "permissions"> {
  return {
    operations: specs.flatMap(toolOperationsFor),
    permissions: specs.flatMap(permissionsFor),
  };
}
