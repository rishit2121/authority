import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { COMPILER_VERSION } from "@/lib/authorization/contract-compiler";
import { toolArgumentsSchema, toolNameSchema } from "@/lib/domain";
import { authorizeThroughGateway, defaultPipelineDeps } from "@/lib/gateway/pipeline";
import { tenantForTask } from "@/lib/gateway/rpc";
import {
  gatewayRegistry,
  riskClassForRegistry,
  registryRequiresApprovalForRegistry,
} from "@/lib/gateway/risk-class";
import {
  UNAUTHENTICATED,
  contractForError,
  extractBearer,
  jsonError,
  jsonOk,
  logHandlerFailure,
  newRequestId,
  readJsonBody,
} from "@/lib/gateway/http";
import { failureContract, toAgentResponse, toAlignmentResponse } from "@/lib/gateway/response";
import { buildTenantRegistry } from "@/lib/registry";
import { deriveResource } from "@/lib/connectors/derive-resource";

/**
 * `POST /api/v1/authorize` — the ONLY supported runtime authorization path.
 *
 * Agents authenticate with a runtime key (Authorization: Bearer). The request
 * schema has no field for a tenant, principal, contract status, permission or
 * policy result: the database re-derives every one of those from the key. The
 * database functions behind this handler are callable only by the gateway's
 * dedicated role — a caller holding just the anonymous key cannot reach them.
 * See docs/api/RUNTIME_API.md for the contract and docs/gateway/TRUST_MODEL.md
 * for the trust boundary.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    taskId: z.string().uuid(),
    tool: toolNameSchema,
    operation: z.string().trim().min(1).max(100),
    resource: z.string().trim().min(1).max(200).optional(),
    arguments: toolArgumentsSchema.default({}),
    planNodeId: z.string().uuid().optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
    /** 1 = single-use (default). Up to 5 for explicitly bounded multi-use. */
    maxUses: z.number().int().min(1).max(5).optional(),
    /** Accepted for compatibility and validated, but never stored. */
    executionContext: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();

  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED, requestId);

  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.contract, requestId);

  const parsed = requestSchema.safeParse(body.body);
  if (!parsed.success) {
    // Field paths only — never the offending values, which may be sensitive.
    return jsonError(
      { http: 400, code: "INVALID_REQUEST", message: "Request failed validation." },
      requestId,
      {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
      },
    );
  }
  const input = parsed.data;

  try {
    // Side-effect-free, called once in addition to (not instead of) the
    // credential resolution `authorizeThroughGateway` already does
    // internally — see gateway.tenant_for_task's own comment. A tenant with
    // no published Custom API operations gets back the exact same registry
    // (and registryVersion) every caller got before this lookup existed; an
    // unresolvable task (null) falls back the same way, and is rejected by
    // the deterministic pipeline's own task/contract lookup regardless.
    const tenantId = await tenantForTask(input.taskId);
    const registry = tenantId ? await buildTenantRegistry(tenantId) : null;
    const registryVersion = registry?.registryVersion ?? gatewayRegistry.registryVersion;

    const result = await authorizeThroughGateway(
      {
        credentialSecret,
        taskId: input.taskId,
        tool: input.tool,
        operation: input.operation,
        resource: input.resource ?? (await deriveResource(input.tool, input.arguments)) ?? undefined,
        arguments: input.arguments,
        planNodeId: input.planNodeId,
        idempotencyKey: input.idempotencyKey,
        maxUses: input.maxUses,
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

    if (result.kind === "failure") return jsonError(failureContract(result.status), requestId);
    if (result.kind === "alignment")
      return jsonOk(toAlignmentResponse({ ...result, tool: input.tool }), requestId);

    return jsonOk(
      toAgentResponse({
        commit: result.commit,
        capabilityToken: result.capabilityToken,
        tool: input.tool,
        operation: input.operation,
        approval: result.approval,
        taskAlignment: result.taskAlignment,
      }),
      requestId,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("authorize", error);
    return jsonError(contract, requestId);
  }
}
