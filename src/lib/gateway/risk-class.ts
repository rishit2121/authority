import "server-only";

import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

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
export function riskClassFor(tool: string): RiskClass {
  const op = registry.operations.get(tool);
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

export { registry as gatewayRegistry };
