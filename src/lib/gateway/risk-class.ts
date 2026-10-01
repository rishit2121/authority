import "server-only";

import { githubDemoRegistry, loadRegistry, type LoadedRegistry } from "@/lib/registry";

export type RiskClass = "low" | "medium" | "high";

const registry = loadRegistry(githubDemoRegistry);

/**
 * The risk class of a tool call, from trusted registry metadata only (never
 * from the request). Drives which calls require a healthy semantic verdict.
 *
 * - high:   deletes, admin actions, money movement, external communication,
 *           confidential/secret data — and any tool the registry does not
 *           know, so an unfamiliar tool never lands in a laxer class.
 * - medium: creates/updates.
 * - low:    reads of public/internal data.
 */
export function riskClassForRegistry(forRegistry: LoadedRegistry, tool: string): RiskClass {
  const op = forRegistry.operations.get(tool);
  if (!op) return "high";
  if (
    op.sideEffect === "write_delete" ||
    op.sideEffect === "admin" ||
    op.financialImpact ||
    op.externalCommunication ||
    op.dataSensitivity === "confidential" ||
    op.dataSensitivity === "secret"
  ) {
    return "high";
  }
  if (op.sideEffect === "write_create" || op.sideEffect === "write_update") return "medium";
  return "low";
}

/** Registry-declared approval requirement (never inferred from the request). */
export function registryRequiresApprovalForRegistry(forRegistry: LoadedRegistry, tool: string): boolean {
  return forRegistry.operations.get(tool)?.requiresApproval ?? false;
}

/** GitHub-fixture-only convenience wrappers, kept for every existing call site that has no tenant context of its own. */
export function riskClassFor(tool: string): RiskClass {
  return riskClassForRegistry(registry, tool);
}

export function registryRequiresApproval(tool: string): boolean {
  return registryRequiresApprovalForRegistry(registry, tool);
}

export { registry as gatewayRegistry };
