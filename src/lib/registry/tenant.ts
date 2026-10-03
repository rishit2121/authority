import "server-only";

import { createHash } from "node:crypto";

import {
  listPublishedCustomOperationsForTenant,
  type TenantPublishedOperation,
} from "@/lib/gateway/rpc-custom-operations";
import {
  listPublishedPostgresQueriesForTenant,
  type TenantPublishedQuery,
} from "@/lib/gateway/rpc-postgres-queries";

import { githubDemoRegistry } from "./fixtures/github-demo";
import { loadRegistry, type LoadedRegistry } from "./load";
import type { Permission, RegistryData, ToolOperation } from "./types";

/**
 * The tenant-scoped counterpart to the module-level `loadRegistry(githubDemoRegistry)`
 * every pipeline stage (plan-validator, solver, contract-compiler, approval-rules,
 * contract-verifier) previously used unconditionally. Merges the static,
 * audited GitHub fixture with whatever Custom API operations and Postgres
 * queries this tenant has actually published -- draft, validated-but-
 * unpublished, retired, and anything on a disconnected connection are all
 * excluded by the two `gateway.list_published_*_for_tenant` reads
 * themselves, not filtered here.
 *
 * A tenant with nothing published in either connector gets back the exact
 * same `LoadedRegistry` (byte-identical `registryVersion`) every caller got
 * before this module existed -- no behavior change, no re-compilation
 * required for any contract that doesn't reference a tenant-published tool.
 */

const MAX_FIELDS = 20;

/** The one shape {@link toolOperationFor}/{@link permissionFor} need, common to both tenant-published sources. */
interface TenantPublishedItem {
  toolName: string;
  connectorId: string;
  effect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
  /** The operation/query slug -- used only as ToolOperation.resourceType's grouping label. */
  slug: string;
  inputSchema: Record<string, unknown>;
  /**
   * Which kind of tenant-published source this is -- drives
   * `externalCommunication` below. A Postgres connection targets the
   * tenant's OWN database (never a third party, regardless of effect); a
   * Custom API connection targets an operator-chosen third-party endpoint,
   * but only a non-read call actually sends anything to it (a GET/read
   * discloses nothing -- only a request body/params sent TO the third
   * party on a write could).
   */
  source: "postgres" | "custom_api";
  /** Sort/fingerprint key for registryVersionFor -- content hashes concatenated so either one changing bumps the version. */
  fingerprint: string;
}

function fromCustomOperation(op: TenantPublishedOperation): TenantPublishedItem {
  return {
    toolName: op.toolName,
    connectorId: op.connectorId,
    effect: op.effect,
    slug: op.operationSlug,
    inputSchema: op.inputSchema,
    source: "custom_api",
    fingerprint: `${op.toolName}:${op.inputSchemaHash ?? ""}:${op.requestMappingHash ?? ""}`,
  };
}

function fromPostgresQuery(q: TenantPublishedQuery): TenantPublishedItem {
  return {
    toolName: q.toolName,
    connectorId: q.connectorId,
    effect: q.effect,
    slug: q.querySlug,
    inputSchema: q.inputSchema,
    source: "postgres",
    fingerprint: `${q.toolName}:${q.inputSchemaHash ?? ""}:${q.sqlTemplateHash ?? ""}`,
  };
}

function sideEffectFor(effect: TenantPublishedItem["effect"]): ToolOperation["sideEffect"] {
  return effect;
}

function classificationFor(effect: TenantPublishedItem["effect"]): Permission["classification"] {
  if (effect === "read") return "read";
  if (effect === "admin") return "admin";
  return "write";
}

function riskCostFor(effect: TenantPublishedItem["effect"]): number {
  if (effect === "read") return 3;
  if (effect === "write_delete" || effect === "admin") return 9;
  return 6;
}

interface InputSchemaShape {
  fields?: Array<{ key: string; type: string; required: boolean; identifiesResource: boolean }>;
}

function toolOperationFor(item: TenantPublishedItem): ToolOperation {
  const schema = item.inputSchema as InputSchemaShape;
  const fields = (schema.fields ?? []).slice(0, MAX_FIELDS);
  return {
    id: item.toolName,
    provider: item.connectorId,
    sideEffect: sideEffectFor(item.effect),
    // No per-operation resource taxonomy is stored for either tenant-
    // published source; the operation/query's own slug is the finest-
    // grained grouping available and is stable for the life of the
    // (immutable, post-publish) definition.
    resourceType: item.slug,
    // A tenant-configured external destination (an HTTP API, a database) is
    // not something this registry can vouch for the sensitivity of --
    // default to the conservative end of the scale rather than guess "public".
    dataSensitivity: "confidential",
    // externalCommunication means disclosure -- information leaving the
    // organization to a recipient this registry cannot vouch for (the
    // established paradigm case is gmail.send_email) -- not merely "this
    // operation happens to target a system outside this process." A
    // Postgres connection targets the TENANT'S OWN database, never a third
    // party, regardless of effect. A Custom API connection genuinely does
    // target an operator-chosen third-party endpoint, but only a non-read
    // call actually sends it anything (a GET/read's response flows IN,
    // disclosing nothing; a write's request body/params flow OUT). Setting
    // this unconditionally for every tenant-published operation, including
    // reads, used to force plan-validator's requires_review gate even for
    // operations that disclose nothing -- conflating "reaches an external
    // system" with "discloses something to one."
    externalCommunication: item.source === "custom_api" && item.effect !== "read",
    financialImpact: false,
    requiresApproval: item.effect !== "read",
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

function permissionFor(item: TenantPublishedItem): Permission {
  return {
    id: `tenant:${item.toolName}`,
    provider: item.connectorId,
    operations: [item.toolName],
    classification: classificationFor(item.effect),
    riskCost: riskCostFor(item.effect),
    // Each synthesized permission covers exactly the one operation it was
    // generated from -- the narrowest possible breadth, so the solver never
    // has a reason to prefer a broader (non-existent) alternative.
    resourceBreadth: 1,
    allowsExternalCommunication: true,
  };
}

/** Deterministic, ≤40-char, backward-compatible: unchanged when a tenant has nothing published in either connector. */
function registryVersionFor(base: string, items: readonly TenantPublishedItem[]): string {
  if (items.length === 0) return base;
  const fingerprint = [...items]
    .map((item) => item.fingerprint)
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
  const [customOps, postgresQueries] = await Promise.all([
    listPublishedCustomOperationsForTenant(tenantId),
    listPublishedPostgresQueriesForTenant(tenantId),
  ]);
  const items = [...customOps.map(fromCustomOperation), ...postgresQueries.map(fromPostgresQuery)];
  if (items.length === 0) return loadRegistry(githubDemoRegistry);

  const data: RegistryData = {
    schemaVersion: 1,
    registryVersion: registryVersionFor(githubDemoRegistry.registryVersion, items),
    operations: [...githubDemoRegistry.operations, ...items.map(toolOperationFor)],
    permissions: [...githubDemoRegistry.permissions, ...items.map(permissionFor)],
  };
  return loadRegistry(data);
}
