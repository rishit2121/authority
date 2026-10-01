import "server-only";

import { createHash } from "node:crypto";

import { listPublishedCustomOperationsForTenant, type TenantPublishedOperation } from "@/lib/gateway/rpc-custom-operations";

import { githubDemoRegistry } from "./fixtures/github-demo";
import { loadRegistry, type LoadedRegistry } from "./load";
import type { Permission, RegistryData, ToolOperation } from "./types";

/**
 * The tenant-scoped counterpart to the module-level `loadRegistry(githubDemoRegistry)`
 * every pipeline stage (plan-validator, solver, contract-compiler, approval-rules,
 * contract-verifier) previously used unconditionally. Merges the static,
 * audited GitHub fixture with whatever Custom API operations this tenant has
 * actually published -- draft, validated-but-unpublished, retired, and
 * operations on a disconnected connection are all excluded by
 * `gateway.list_published_custom_operations_for_tenant` itself, not filtered
 * here.
 *
 * A tenant with zero published custom operations gets back the exact same
 * `LoadedRegistry` (byte-identical `registryVersion`) every caller got before
 * this module existed -- no behavior change, no re-compilation required for
 * any contract that doesn't reference a custom tool.
 */

const MAX_FIELDS = 20;

function sideEffectFor(effect: TenantPublishedOperation["effect"]): ToolOperation["sideEffect"] {
  return effect;
}

function classificationFor(effect: TenantPublishedOperation["effect"]): Permission["classification"] {
  if (effect === "read") return "read";
  if (effect === "admin") return "admin";
  return "write";
}

function riskCostFor(effect: TenantPublishedOperation["effect"]): number {
  if (effect === "read") return 3;
  if (effect === "write_delete" || effect === "admin") return 9;
  return 6;
}

interface InputSchemaShape {
  fields?: Array<{ key: string; type: string; required: boolean; identifiesResource: boolean }>;
}

function toolOperationFor(op: TenantPublishedOperation): ToolOperation {
  const schema = op.inputSchema as InputSchemaShape;
  const fields = (schema.fields ?? []).slice(0, MAX_FIELDS);
  return {
    id: op.toolName,
    provider: op.connectorId,
    sideEffect: sideEffectFor(op.effect),
    // No per-operation resource taxonomy is stored for Custom API; the
    // operation's own slug is the finest-grained grouping available and is
    // stable for the life of the (immutable, post-publish) definition.
    resourceType: op.operationSlug,
    // A tenant-configured external HTTP destination is not something this
    // registry can vouch for the sensitivity of -- default to the
    // conservative end of the scale rather than guess "public".
    dataSensitivity: "confidential",
    // Calling an operator-chosen external API is external communication by
    // definition; this unconditionally forces plan-validator's
    // requires_review gate (see plan-validator.ts), regardless of effect.
    externalCommunication: true,
    financialImpact: false,
    requiresApproval: op.effect !== "read",
    argumentFields: fields.map((f) => ({
      key: f.key,
      type: f.type as "string" | "number" | "boolean",
      required: f.required,
      identifiesResource: f.identifiesResource,
    })),
    preconditions: [],
    effects: [],
    alternativeOperationIds: [],
  };
}

function permissionFor(op: TenantPublishedOperation): Permission {
  return {
    id: `custom:${op.toolName}`,
    provider: op.connectorId,
    operations: [op.toolName],
    classification: classificationFor(op.effect),
    riskCost: riskCostFor(op.effect),
    // Each synthesized permission covers exactly the one operation it was
    // generated from -- the narrowest possible breadth, so the solver never
    // has a reason to prefer a broader (non-existent) alternative.
    resourceBreadth: 1,
    allowsExternalCommunication: true,
  };
}

/** Deterministic, ≤40-char, backward-compatible: unchanged when a tenant has no published custom operations at all. */
function registryVersionFor(base: string, customOps: readonly TenantPublishedOperation[]): string {
  if (customOps.length === 0) return base;
  const fingerprint = [...customOps]
    .map((op) => `${op.toolName}:${op.inputSchemaHash ?? ""}:${op.requestMappingHash ?? ""}`)
    .sort()
    .join("|");
  const suffix = createHash("sha256").update(fingerprint).digest("hex").slice(0, 8);
  return `${base}+c${suffix}`;
}

/**
 * Builds the registry a given tenant's plan-validator/solver/compiler/
 * verifier call should use for this request. Never accepts a tenant id from
 * a request body directly -- every call site resolves it server-side first
 * (an authenticated session's own tenant, or a task id resolved through
 * `gateway.jev_risk_mode_for_task`'s side-effect-free pattern for the
 * runtime authorize path).
 */
export async function buildTenantRegistry(tenantId: string): Promise<LoadedRegistry> {
  const customOps = await listPublishedCustomOperationsForTenant(tenantId);
  if (customOps.length === 0) return loadRegistry(githubDemoRegistry);

  const data: RegistryData = {
    schemaVersion: 1,
    registryVersion: registryVersionFor(githubDemoRegistry.registryVersion, customOps),
    operations: [...githubDemoRegistry.operations, ...customOps.map(toolOperationFor)],
    permissions: [...githubDemoRegistry.permissions, ...customOps.map(permissionFor)],
  };
  return loadRegistry(data);
}
