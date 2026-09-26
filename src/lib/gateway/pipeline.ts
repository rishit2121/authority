import "server-only";

import { z } from "zod";

import { toolArgumentsSchema, type SemanticEvidence } from "@/lib/domain";
import { breakerFor, type CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import { createSemanticProvider } from "@/lib/semantic/config";
import type { SemanticRiskProvider } from "@/lib/semantic/provider";
import { runSemanticEvaluation } from "@/lib/semantic/runner";

import { buildArgumentAudit, sanitizeResource, type ArgumentValue } from "./argument-audit";
import { generateCapabilityToken } from "./capability-token";
import { commitAuthorization, prepareAuthorization, type CommitResult, type GatewayStatus } from "./rpc";
import { riskClassFor } from "./risk-class";

export const GATEWAY_VERSION = "authority-gateway-2026-09-29";

const priorCallsSchema = z.array(z.object({ tool: z.string(), arguments: toolArgumentsSchema })).max(5);

export interface AuthorizeInput {
  credentialSecret: string;
  taskId: string;
  tool: string;
  operation: string;
  resource?: string;
  arguments: Record<string, ArgumentValue>;
  planNodeId?: string;
  idempotencyKey: string;
  /** 1 (default, single-use) to 5 (explicitly bounded multi-use). */
  maxUses?: number;
  registryVersion: string;
  compilerVersion: string;
}

export type PipelineResult =
  | { kind: "failure"; status: Exclude<GatewayStatus, "ok"> }
  | { kind: "decision"; commit: CommitResult; capabilityToken: string | null; riskClass: string };

export interface PipelineDeps {
  prepare: typeof prepareAuthorization;
  commit: typeof commitAuthorization;
  createProvider: (name: string, model: string) => SemanticRiskProvider;
  breakerFor: (key: string) => CircuitBreaker;
}

export const defaultPipelineDeps: PipelineDeps = {
  prepare: prepareAuthorization,
  commit: commitAuthorization,
  createProvider: createSemanticProvider,
  breakerFor,
};

/**
 * The one trusted authorization path (Part 6):
 *
 *   gateway authentication → deterministic pre-evaluation (prepare)
 *   → semantic evaluation when configured → atomic commit
 *
 * The database commit re-runs the deterministic evaluation authoritatively,
 * composes it monotonically with the semantic evidence, persists everything
 * and issues the capability in ONE transaction. Nothing computed here is
 * trusted to widen anything: the semantic evidence is only an input to a
 * function that can only narrow.
 *
 * A semantic failure of any kind yields degraded evidence (never an
 * exception), which the database turns into either a fail-closed deny (when
 * semantic evidence is required for the call's risk class) or an explicit
 * degraded record that keeps the deterministic result (when optional).
 */
export async function authorizeThroughGateway(
  input: AuthorizeInput,
  deps: PipelineDeps = defaultPipelineDeps,
): Promise<PipelineResult> {
  const riskClass = riskClassFor(input.tool);
  const maxUses = input.maxUses ?? 1;
  const argumentAudit = buildArgumentAudit(input.arguments);
  const resource = sanitizeResource(input.resource);

  const prepared = await deps.prepare({
    credentialSecret: input.credentialSecret,
    taskId: input.taskId,
    tool: input.tool,
    args: input.arguments,
    idempotencyKey: input.idempotencyKey,
    registryVersion: input.registryVersion,
    compilerVersion: input.compilerVersion,
    riskClass,
    maxUses,
  });
  if (prepared.status !== "ok") return { kind: "failure", status: prepared.status };

  let evidence: SemanticEvidence | null = null;
  if (prepared.mode !== "off" && !prepared.alreadyDecided && prepared.provider && prepared.model) {
    const provider = deps.createProvider(prepared.provider, prepared.model);
    const prior = priorCallsSchema.safeParse(prepared.priorCalls);
    const result = await runSemanticEvaluation({
      provider,
      breaker: deps.breakerFor(`${provider.name}:${provider.model}`),
      timeoutMs: prepared.timeoutMs ?? undefined,
      input: {
        taskIntent: prepared.taskIntent ?? "(unknown)",
        tool: input.tool,
        operation: input.operation,
        resource,
        arguments: input.arguments,
        contractAllowedTools: prepared.allowedTools,
        priorCalls: prior.success ? prior.data : [],
      },
    });
    evidence = result.evidence;
  }

  const token = generateCapabilityToken();
  const commit = await deps.commit({
    credentialSecret: input.credentialSecret,
    taskId: input.taskId,
    tool: input.tool,
    operation: input.operation,
    resource,
    args: input.arguments,
    argumentAudit,
    planNodeId: input.planNodeId ?? null,
    idempotencyKey: input.idempotencyKey,
    registryVersion: input.registryVersion,
    compilerVersion: input.compilerVersion,
    riskClass,
    maxUses,
    tokenHash: token.hash,
    evidence,
    gatewayVersion: GATEWAY_VERSION,
  });
  if (commit.status !== "ok") return { kind: "failure", status: commit.status };

  return {
    kind: "decision",
    commit,
    // Plaintext leaves this function only when a capability was issued *now*.
    capabilityToken: commit.capabilityId && !commit.replayed ? token.plaintext : null,
    riskClass,
  };
}
