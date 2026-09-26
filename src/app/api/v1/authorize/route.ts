import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { idSchema, toolArgumentsSchema, toolNameSchema } from "@/lib/domain";
import { COMPILER_VERSION } from "@/lib/authorization/contract-compiler";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";
import {
  authorizeToolCall,
  AuthorizeToolCallError,
  type AuthorizeFailureReason,
} from "@/lib/runtime/authorize-tool-call";
import { summarizeReasonCodes } from "@/lib/runtime/reason-codes";
import { recordAgentAuthFailure } from "@/lib/runtime/semantic-rpc";
import { runSemanticShadowForDecision } from "@/lib/semantic/shadow";
import { createRuntimeClient } from "@/lib/supabase/runtime-client";

/**
 * `POST /api/v1/authorize` — the one runtime authorization entry point an
 * agent calls before executing a tool.
 *
 * This handler is deliberately thin: it validates request *shape*, extracts
 * the credential from the Authorization header, and calls
 * `authorize_tool_call()`, which is the actual authority (see that
 * migration's module doc). It never accepts a tenant id, principal id,
 * contract status, or any policy/permission result from the request body —
 * the schema below has no field for any of them, and the RPC re-derives
 * every one of those facts itself from the credential and the database.
 *
 * No Supabase session is involved: `createRuntimeClient()` uses only the
 * public publishable key, exactly as any anonymous caller would, because
 * the RPC it calls authenticates the caller itself.
 */

const registry = loadRegistry(githubDemoRegistry);

const requestSchema = z
  .object({
    taskId: idSchema,
    tool: toolNameSchema,
    operation: z.string().trim().min(1).max(100),
    resource: z.string().trim().min(1).max(500).optional(),
    arguments: toolArgumentsSchema.optional(),
    planNodeId: idSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
    executionContext: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const STATUS_FOR_FAILURE: Record<AuthorizeFailureReason, number> = {
  invalid_credential: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  rate_limited: 429,
  invalid_request: 400,
  unknown: 500,
};

function extractBearerSecret(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function POST(request: NextRequest) {
  const credentialSecret = extractBearerSecret(request);
  if (!credentialSecret) {
    return NextResponse.json(
      { error: { reason: "invalid_credential", message: "Missing or malformed Authorization header." } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { reason: "invalid_request", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          reason: "invalid_request",
          message: "Request failed validation.",
          issues: parsed.error.issues,
        },
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const supabase = createRuntimeClient();

  try {
    const result = await authorizeToolCall(supabase, {
      credentialSecret,
      taskId: input.taskId,
      tool: input.tool,
      operation: input.operation,
      resource: input.resource,
      arguments: input.arguments,
      planNodeId: input.planNodeId,
      idempotencyKey: input.idempotencyKey,
      executionContext: input.executionContext,
      currentRegistryVersion: registry.registryVersion,
      currentCompilerVersion: COMPILER_VERSION,
    });

    // The deterministic decision above is final and already persisted. The
    // semantic step below runs strictly afterwards, never throws, and only
    // adds a separately-labeled, non-authoritative observation to the reply.
    const semantic = await runSemanticShadowForDecision(supabase, credentialSecret, result.decisionId);

    return NextResponse.json({
      decisionId: result.decisionId,
      status: result.outcome,
      reasonCodes: result.reasonCodes,
      summary: summarizeReasonCodes(result.reasonCodes),
      contract: result.contractId ? { id: result.contractId, version: result.contractVersion } : null,
      remainingInvocations: result.remainingInvocations,
      requiresApproval: result.outcome === "require_approval",
      requiresClarification: result.outcome === "clarify",
      requiresReplan: result.outcome === "replan",
      wasReplayed: result.wasReplayed,
      semantic,
    });
  } catch (error) {
    if (error instanceof AuthorizeToolCallError) {
      // authorize_tool_call() raises on a bad/revoked credential, which rolls
      // back the audit row it inserted first — so the failure is recorded by
      // a separate call that returns normally (Part 5 fix for a Part 4 gap).
      if (error.reason === "invalid_credential") await recordAgentAuthFailure(supabase, credentialSecret);
      return NextResponse.json(
        { error: { reason: error.reason, message: error.message } },
        { status: STATUS_FOR_FAILURE[error.reason] },
      );
    }
    console.error("authorize route: unexpected failure", error);
    return NextResponse.json(
      { error: { reason: "unknown", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
