import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { COMPILER_VERSION } from "@/lib/authorization/contract-compiler";
import { executeConnectorOperation } from "@/lib/connectors/executor";
import { executeGithubOperation } from "@/lib/github/executor";
import { sanitizeResource, type ArgumentValue } from "@/lib/gateway/argument-audit";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway, defaultPipelineDeps } from "@/lib/gateway/pipeline";
import { activeContractForTask, tenantForTask } from "@/lib/gateway/rpc";
import {
  gatewayRegistry,
  registryRequiresApprovalForRegistry,
  riskClassForRegistry,
} from "@/lib/gateway/risk-class";
import { buildTenantRegistry } from "@/lib/registry";
import type { ToolOperation } from "@/lib/registry/types";

/**
 * Translates Authority's existing authorize+execute pipeline into MCP's
 * tools/list + tools/call shape (Phase 17 of the agent-integration
 * roadmap). This is a thin protocol bridge, not a new trust path: every
 * tool call here goes through the exact same
 * gateway.prepare_authorization / commit_authorization /
 * reserve_connector_execution sequence as the REST API
 * (src/app/api/v1/authorize, src/app/api/v1/execute,
 * src/app/api/v1/github/execute) -- a revoked credential, an exhausted
 * budget, an out-of-scope resource, or a tool requiring human approval is
 * rejected exactly as it would be there. Nothing here mints, caches, or
 * widens a capability; nothing here lets an MCP session act on more than
 * the one task its connection URL names.
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  /** A Zod raw shape -- `@modelcontextprotocol/sdk`'s own `registerTool` converts this to the wire JSON Schema. */
  inputSchema: Record<string, z.ZodTypeAny>;
  operation: ToolOperation;
}

function zodFieldFor(field: ToolOperation["argumentFields"][number]): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  if (field.type === "string") base = z.string();
  else if (field.type === "number") base = z.number();
  else if (field.type === "boolean") base = z.boolean();
  else base = z.array(z.string());
  return field.required ? base : base.optional();
}

function describeOperation(operation: ToolOperation): string {
  const parts = [`${operation.sideEffect} on ${operation.resourceType}.`];
  if (operation.requiresApproval) parts.push("Requires approval.");
  if (operation.externalCommunication) parts.push("Sends data outside the organization.");
  if (operation.financialImpact) parts.push("Has financial impact.");
  return parts.join(" ");
}

export type McpToolCatalogStatus = "ok" | "task_not_found" | "no_active_contract";

export interface McpToolCatalog {
  status: McpToolCatalogStatus;
  tenantId: string | null;
  tools: McpToolDefinition[];
}

/**
 * Every distinct tool this task's current active contract allows, resolved
 * against the tenant's own compiled registry for its description and
 * argument schema. Pure discovery: listing a tool here grants nothing by
 * itself (see `authorizeAndExecuteMcpTool`, the only function that actually
 * runs anything), so this never needs to re-verify the caller's credential
 * beyond a bearer token having been presented at all -- the route layer
 * enforces that; see src/app/api/mcp/tasks/[taskId]/route.ts's own comment.
 */
export async function buildMcpToolCatalog(taskId: string): Promise<McpToolCatalog> {
  const tenantId = await tenantForTask(taskId);
  if (!tenantId) return { status: "task_not_found", tenantId: null, tools: [] };

  const contract = await activeContractForTask(taskId);
  if (!contract) return { status: "no_active_contract", tenantId, tools: [] };

  const registry = await buildTenantRegistry(tenantId);
  const seen = new Set<string>();
  const tools: McpToolDefinition[] = [];
  for (const action of contract.allowedActions) {
    if (seen.has(action.tool)) continue;
    seen.add(action.tool);
    const operation = registry.operations.get(action.tool);
    // The contract named a tool the current registry no longer defines
    // (e.g. a retired Custom API/Postgres operation) -- never guess at its
    // shape; simply omit it from the catalog. A direct tools/call for it
    // would still be independently rejected by the real pipeline below.
    if (!operation) continue;
    const inputSchema: Record<string, z.ZodTypeAny> = {};
    for (const field of operation.argumentFields) inputSchema[field.key] = zodFieldFor(field);
    tools.push({ name: operation.id, description: describeOperation(operation), inputSchema, operation });
  }
  return { status: "ok", tenantId, tools };
}

export interface McpToolCallResult {
  /** Never a protocol-level failure -- this is the content of a successful MCP response; see the route's own isError handling. */
  success: boolean;
  summary: string;
  body: Record<string, unknown>;
}

/**
 * Authorizes and immediately executes exactly one tool call -- the MCP
 * equivalent of an agent calling `/api/v1/authorize` followed by
 * `/api/v1/execute` (or `/api/v1/github/execute`), combined into one
 * request/response because MCP's `tools/call` has no second round trip.
 * The resource a capability binds against is derived from the one
 * argument field the registry marks `identifiesResource` -- the same value
 * a human-built UI call would use -- never supplied as a separate MCP
 * parameter, to keep every tool's input schema exactly its own declared
 * arguments.
 */
export async function authorizeAndExecuteMcpTool(input: {
  credentialSecret: string;
  taskId: string;
  tool: string;
  operation: ToolOperation;
  args: Record<string, unknown>;
}): Promise<McpToolCallResult> {
  const resourceField = input.operation.argumentFields.find((f) => f.identifiesResource);
  const rawResource = resourceField ? input.args[resourceField.key] : undefined;
  if (resourceField && (rawResource === undefined || rawResource === null)) {
    return {
      success: false,
      summary: `"${resourceField.key}" is required to identify what this call applies to.`,
      body: { error: { code: "ARGUMENT_MISSING" } },
    };
  }
  const resource = sanitizeResource(rawResource !== undefined ? String(rawResource) : undefined) ?? "";
  const operationScope = input.tool.slice(input.tool.indexOf(".") + 1);

  const tenantId = await tenantForTask(input.taskId);
  const registry = tenantId ? await buildTenantRegistry(tenantId) : null;
  const registryVersion = registry?.registryVersion ?? gatewayRegistry.registryVersion;

  const authorized = await authorizeThroughGateway(
    {
      credentialSecret: input.credentialSecret,
      taskId: input.taskId,
      tool: input.tool,
      operation: operationScope,
      resource,
      // The MCP SDK already validated input.args against this tool's own
      // per-field Zod schema (string/number/boolean/string[]) before this
      // function is ever called -- see zodFieldFor above -- so this cast
      // reflects an already-enforced invariant, not an unchecked assumption.
      arguments: input.args as Record<string, ArgumentValue>,
      idempotencyKey: randomUUID(),
      maxUses: 1,
      registryVersion,
      compilerVersion: COMPILER_VERSION,
    },
    registry
      ? {
          ...defaultPipelineDeps,
          riskClassFor: (tool) => riskClassForRegistry(registry, tool),
          registryRequiresApproval: (tool) => registryRequiresApprovalForRegistry(registry, tool),
        }
      : defaultPipelineDeps,
  );

  if (authorized.kind === "failure") {
    return {
      success: false,
      summary: "This credential could not be used for this task.",
      body: { error: { code: authorized.status } },
    };
  }
  if (!authorized.capabilityToken) {
    // require_approval, or a replay that settled without minting a new
    // token: the agent must wait or poll, exactly as the REST API's own
    // response already models -- never silently retried, never treated as denied.
    return {
      success: false,
      summary:
        authorized.commit.finalOutcome === "require_approval"
          ? "This action requires human approval before it can run."
          : "This request was already handled; no new capability was issued.",
      body: { outcome: authorized.commit.finalOutcome, reasonCodes: authorized.commit.reasonCodes },
    };
  }

  const executor = input.tool.startsWith("github.") ? executeGithubOperation : executeConnectorOperation;
  const result = await executor({
    credentialSecret: input.credentialSecret,
    tokenHash: hashCapabilityToken(authorized.capabilityToken),
    tool: input.tool,
    operation: operationScope,
    resource,
    args: input.args,
    idempotencyKey: randomUUID(),
  });

  const ok = result.http >= 200 && result.http < 300;
  return { success: ok, summary: ok ? "Succeeded." : "Failed.", body: result.body };
}
