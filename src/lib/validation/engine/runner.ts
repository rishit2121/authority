import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { COMPILER_VERSION } from "@/lib/authorization/contract-compiler";
import { buildArgumentAudit } from "@/lib/gateway/argument-audit";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { agentGuidance } from "@/lib/gateway/guidance";
import { authorizeThroughGateway, defaultPipelineDeps } from "@/lib/gateway/pipeline";
import { consumeCapability, revokeCapabilityViaGateway } from "@/lib/gateway/rpc";
import { markDispatched } from "@/lib/gateway/rpc-github";
import { agentReasonCodes } from "@/lib/gateway/response";
import { GithubClient } from "@/lib/github/client";
import { defaultExecutorDeps, executeGithubOperation } from "@/lib/github/executor";
import { MockGithub } from "@/lib/github/mock";
import { OPERATIONS } from "@/lib/github/operations";
import { CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import { classifyDisagreement } from "@/lib/semantic/risk";

import { emptyMetrics } from "../metrics";
import type { EffectiveContract } from "../remediation";
import type {
  AttackStep,
  BoundaryRule,
  ConfigPatch,
  Control,
  Decision,
  EffectRecord,
  EnvironmentSpec,
  RunMetrics,
  RunResult,
  Scenario,
  StepActual,
  StepResult,
} from "../schema";
import { compileScenarioContract, registry, ScenarioAuthoringError } from "./compile";
import { responsibleControl } from "./controls";
import * as vl from "./db";
import { compareOutcome, falsePositive, leaked } from "./evaluate";
import { ScriptedSemanticProvider } from "./scripted-provider";
import { hashSeed, prng, resolveTemplates, templateContext } from "./templates";

/**
 * The campaign engine's unit of work: ONE scenario, in ONE isolated sandbox tenant, through the REAL authorization
 * gateway and the REAL GitHub connector — with the only external effects being in-memory mocks. Deterministic for a
 * given (scenario, variant, patch, seed): names, idempotency keys and race jitter derive from the seed.
 */

export interface RunOptions {
  scenario: Scenario;
  variant: string;
  patch?: ConfigPatch;
  seed: number;
  repetition: number;
  ownerTenantId: string | null;
  actorUserId: string | null;
  limits: EnvironmentSpec["limits"];
  sandboxMinutes: number;
  signal?: AbortSignal;
  onStep?: (step: StepResult) => void | Promise<void>;
}

export interface RunOutcome {
  result: RunResult;
  effective: EffectiveContract;
  /** The exact scenario (placeholders resolved) that was executed. */
  resolved: Scenario;
  sandboxDestroyed: boolean;
}

const PERMITTING = new Set(["allow", "allow_constrained"]);
const CONNECTOR = new Set([
  "github.get_issue",
  "github.read_repository",
  "github.create_branch",
  "github.put_file",
  "github.create_pull_request",
  "github.get_pull_request",
]);

const newKey = () => {
  const secret = `authority_rk_${randomBytes(32).toString("hex")}`;
  return { secret, prefix: secret.slice(0, 21), hash: createHash("sha256").update(secret).digest("hex") };
};

function globToRegex(glob: string): RegExp {
  return new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  );
}

function matchesRule(effect: EffectRecord, rule: BoundaryRule): boolean {
  if (effect.tool !== rule.tool) return false;
  if (!rule.where) return true;
  const raw = effect.args[rule.where.key];
  if (raw === undefined) return false;
  switch (rule.where.op) {
    case "equals":
      return String(raw) === String(rule.where.value);
    case "not_equals":
      return String(raw) !== String(rule.where.value);
    case "matches":
      return globToRegex(String(rule.where.value)).test(String(raw));
    case "gt":
      return Number(raw) > Number(rule.where.value);
  }
}

interface Captured {
  token: string;
  capabilityId: string | null;
  tool: string;
  operation: string;
  resource: string | undefined;
  args: Record<string, string | number | boolean>;
  agent: "primary" | "other" | "victim";
  taskId: string;
}

function toDecision(v: string | null | undefined): Decision | null {
  return v && ["allow", "allow_constrained", "deny", "require_approval", "replan", "clarify"].includes(v)
    ? (v as Decision)
    : null;
}

export async function runScenario(opts: RunOptions): Promise<RunOutcome> {
  const started = Date.now();
  const deadline = started + Math.min(opts.limits.maxScenarioMs, 120_000);
  const seedNum = hashSeed(opts.scenario.key + opts.variant, opts.seed + opts.repetition);
  const rng = prng(seedNum);
  const taskId = randomUUID();
  const ctx = templateContext(taskId, seedNum);
  const scenario = resolveTemplates(opts.scenario, ctx);

  const variant = scenario.variants.find((v) => v.label === opts.variant);
  if (opts.variant !== "baseline" && !variant)
    throw new ScenarioAuthoringError(`scenario ${scenario.key} has no variant "${opts.variant}"`);
  const patches = [
    ...(scenario.appliedPatch ? [scenario.appliedPatch] : []),
    ...(variant ? [variant.patch] : []),
    ...(opts.patch ? [opts.patch] : []),
  ];
  const { contract, effective } = compileScenarioContract(scenario, taskId, patches);

  const empty = (
    verdict: RunResult["verdict"],
    status: RunResult["status"],
    errorCategory?: string,
  ): RunOutcome => ({
    result: {
      scenarioKey: scenario.key,
      scenarioVersion: scenario.version,
      variant: opts.variant,
      repetition: opts.repetition,
      seed: opts.seed,
      status,
      verdict,
      steps: [],
      effects: [],
      metrics: emptyMetrics(),
      errorCategory,
      durationMs: Date.now() - started,
    },
    effective,
    resolved: scenario,
    sandboxDestroyed: true,
  });
  if (scenario.steps.length > opts.limits.maxScenarioSteps) return empty("error", "error", "step_limit");

  const agents: Record<"primary" | "other", ReturnType<typeof newKey>> = {
    primary: newKey(),
    other: newKey(),
  };
  const victimKey = newKey();
  const sandboxIds: string[] = [];
  const steps: StepResult[] = [];
  const effects: EffectRecord[] = [];
  const breaker = new CircuitBreaker();
  const mock = new MockGithub({ empty: true });
  const client = new GithubClient(mock, () => "mock-app-jwt", "mock");
  const captured = new Map<string, Captured>();
  const authInputs = new Map<
    string,
    {
      actor: "primary" | "other" | "victim";
      taskId: string;
      tool: string;
      operation: string;
      resource: string | undefined;
      args: Record<string, string | number | boolean>;
      key: string;
      maxUses?: number;
      registryVersion?: string;
      semantic?: AttackStep["semantic"];
    }
  >();
  const authKeyByStep = new Map<string, string>();
  let lastExecKey: string | null = null;
  let lastSuccessKey: string | null = null;
  let seq = 0;
  let sandboxId = "";
  let victimSandboxId = "";
  let seeded: vl.SeededSandbox | null = null;
  let victimSeeded: vl.SeededSandbox | null = null;

  const keyFor = (prefix: string) => `${prefix}-${ctx.tag}-${Math.floor(rng() * 1e6).toString(36)}-${++seq}`;

  try {
    sandboxId = await vl.createSandbox({
      ownerTenantId: opts.ownerTenantId,
      actorUserId: opts.actorUserId,
      ttlMinutes: opts.sandboxMinutes,
    });
    sandboxIds.push(sandboxId);
    const repos = scenario.environment.github?.repos ?? [];
    seeded = await vl.seedSandbox(sandboxId, {
      taskId,
      intent: scenario.intent,
      primaryAgent: "primary",
      agents: [
        { key: "primary", keyPrefix: agents.primary.prefix, keyHash: agents.primary.hash },
        { key: "other", keyPrefix: agents.other.prefix, keyHash: agents.other.hash },
      ],
      contract,
      settings: {
        mode: effective.semanticMode,
        provider: "mock",
        model: "mock-heuristic",
        timeoutMs: scenario.environment.semantic.timeoutMs,
        requiredClasses: effective.requiredClasses,
        capabilityTtlSeconds: effective.capabilityTtlSeconds,
        approvalClasses: effective.approvalClasses,
      },
      ...(scenario.environment.github
        ? {
            github: {
              repos: repos.map((r) => ({ owner: r.owner, name: r.name })),
              boundRepo: scenario.environment.github.boundRepo,
            },
          }
        : {}),
    });
    if (scenario.environment.github && seeded.installationGhId != null)
      mock.registerInstallation(Number(seeded.installationGhId), repos);

    if (scenario.environment.victim) {
      victimSandboxId = await vl.createSandbox({
        ownerTenantId: opts.ownerTenantId,
        actorUserId: opts.actorUserId,
        ttlMinutes: opts.sandboxMinutes,
      });
      sandboxIds.push(victimSandboxId);
      const victimTask = randomUUID();
      const victimScenario = {
        ...scenario,
        intent: "Victim tenant task (must be unreachable from the attacker)",
      };
      const vc = compileScenarioContract(victimScenario, victimTask, []);
      victimSeeded = await vl.seedSandbox(victimSandboxId, {
        taskId: victimTask,
        intent: victimScenario.intent,
        primaryAgent: "primary",
        agents: [{ key: "primary", keyPrefix: victimKey.prefix, keyHash: victimKey.hash }],
        contract: vc.contract,
        settings: {
          mode: "off",
          provider: "mock",
          model: "mock-heuristic",
          requiredClasses: [],
          capabilityTtlSeconds: 60,
          approvalClasses: [],
        },
      });
    }

    const secretFor = (a: "primary" | "other" | "victim") =>
      a === "victim" ? victimKey.secret : agents[a].secret;
    const agentIdFor = (a: "primary" | "other" | "victim") =>
      (a === "victim" ? victimSeeded?.agents.primary : seeded?.agents[a]) ?? "";
    const taskFor = (a: "primary" | "other" | "victim", target: "own" | "victim") =>
      a === "victim" || target === "victim" ? (victimSeeded?.taskId ?? taskId) : seeded!.taskId;
    const sandboxFor = (target: "own" | "victim") =>
      target === "victim" ? victimSandboxId || sandboxId : sandboxId;

    const record = async (result: StepResult) => {
      steps.push(result);
      await opts.onStep?.(result);
    };

    const doAuthorize = async (
      input: NonNullable<ReturnType<typeof authInputs.get>>,
    ): Promise<{
      actual: StepActual;
      token: string | null;
      capabilityId: string | null;
      latencyMs: number;
      toolRequestId: string | null;
    }> => {
      const t0 = performance.now();
      const provider = new ScriptedSemanticProvider(input.semantic);
      const r = await authorizeThroughGateway(
        {
          credentialSecret: secretFor(input.actor),
          taskId: input.taskId,
          tool: input.tool,
          operation: input.operation,
          resource: input.resource,
          arguments: input.args,
          idempotencyKey: input.key,
          maxUses: input.maxUses,
          registryVersion: input.registryVersion ?? registry.registryVersion,
          compilerVersion: COMPILER_VERSION,
        },
        // A fresh circuit breaker per run: a provider fault injected by one scenario must not degrade another.
        { ...defaultPipelineDeps, createProvider: () => provider, breakerFor: () => breaker },
      );
      const latencyMs = Math.round(performance.now() - t0);
      if (r.kind === "failure") {
        return {
          actual: {
            finalDecision: null,
            reasonCodes: [r.status],
            capability: "not_issued",
            execution: "n/a",
            status: r.status,
          },
          token: null,
          capabilityId: null,
          latencyMs,
          toolRequestId: null,
        };
      }
      const c = r.commit;
      const codes = agentReasonCodes(c.reasonCodes);
      const final = toDecision(c.finalOutcome);
      return {
        actual: {
          finalDecision: final,
          deterministicDecision: toDecision(c.detOutcome),
          reasonCodes: c.reasonCodes,
          capability: c.capabilityId ? "issued" : "not_issued",
          execution: "n/a",
          replayed: c.replayed,
          approval: r.approval?.state ?? null,
          guidance: agentGuidance(final, codes),
        },
        token: r.capabilityToken,
        capabilityId: c.capabilityId,
        latencyMs,
        toolRequestId: c.toolRequestId,
      };
    };

    const doExecute = async (
      cap: Captured,
      opt: {
        tool: string;
        operation: string;
        resource: string | undefined;
        args: Record<string, string | number | boolean>;
        key: string;
        faultBeforeDispatch?: string;
        step: AttackStep;
      },
    ): Promise<{
      executed: boolean;
      noop: boolean;
      replayed: boolean;
      code: string | null;
      http: number | null;
    }> => {
      const secret = secretFor(cap.agent);
      if (CONNECTOR.has(opt.tool) || OPERATIONS.has(opt.tool) || opt.tool.startsWith("github.")) {
        const res = await executeGithubOperation(
          {
            credentialSecret: secret,
            tokenHash: hashCapabilityToken(cap.token),
            tool: opt.tool,
            operation: opt.operation,
            resource: opt.resource ?? null,
            args: opt.args,
            idempotencyKey: opt.key,
          },
          {
            ...defaultExecutorDeps,
            mode: () => "mock",
            ready: () => ({ ready: true, missing: [] }),
            client: () => client,
            deadlineMs: 6000,
            dispatch: async (i) => {
              if (opt.faultBeforeDispatch)
                await vl.applyFault(
                  sandboxFor(opt.step.target),
                  opt.faultBeforeDispatch,
                  opt.step.faultParams ?? {},
                );
              return markDispatched(i);
            },
          },
        );
        const body = res.body as { result?: string; replayed?: boolean; error?: { code?: string } };
        const ok = res.http === 200 && (body.result === "succeeded" || body.result === "succeeded_noop");
        return {
          executed: ok,
          noop: body.result === "succeeded_noop",
          replayed: Boolean(body.replayed),
          code: body.error?.code ?? (body.replayed ? "REPLAYED" : null),
          http: res.http,
        };
      }
      const r = await consumeCapability({
        credentialSecret: secret,
        tokenHash: hashCapabilityToken(cap.token),
        tool: opt.tool,
        operation: opt.operation,
        resource: opt.resource ?? null,
        args: opt.args,
        idempotencyKey: opt.key,
      });
      if (r.status !== "ok")
        return { executed: false, noop: false, replayed: false, code: "UNAUTHENTICATED", http: 401 };
      return {
        executed: r.result === "accepted" && !r.replayed,
        noop: false,
        replayed: r.replayed,
        code: r.result === "accepted" ? null : r.reasonCode,
        http: r.result === "accepted" ? 200 : 409,
      };
    };

    for (const step of scenario.steps) {
      if (opts.signal?.aborted) {
        return finish("cancelled");
      }
      if (Date.now() > deadline) {
        await record(
          mkResult(
            step,
            { finalDecision: null, reasonCodes: [], capability: "n/a", execution: "n/a" },
            "error",
            ["scenario time limit exceeded"],
            null,
            null,
          ),
        );
        return finish("error", "timeout");
      }
      const actor = step.actor;
      const stepTaskId = taskFor(actor, step.target);
      const tool = step.tool ?? "";
      const operation = step.operation ?? tool.split(".")[1] ?? "op";
      const stepStart = Date.now();
      const requestSummary = (
        args: Record<string, string | number | boolean>,
        t?: string,
        res?: string | undefined,
      ) => ({
        tool: t ?? tool,
        operation,
        resource: res ?? step.resource ?? null,
        actor,
        target: step.target,
        argumentAudit: buildArgumentAudit(args as never),
        argumentValues: args,
      });

      try {
        if (step.action === "fault") {
          await vl.applyFault(sandboxFor(step.target), step.fault ?? "", step.faultParams ?? {});
          await record({
            seq: steps.length,
            stepKey: step.id,
            kind: "fault",
            action: "fault",
            label: step.label,
            request: { fault: step.fault },
            expected: {},
            actual: { reasonCodes: [], capability: "n/a", execution: "n/a", status: `applied:${step.fault}` },
            verdict: "pass",
            control: null,
            mismatches: [],
            latencyMs: Date.now() - stepStart,
            occurredAt: new Date().toISOString(),
            evidence: null,
          });
          continue;
        }

        if (step.action === "revoke_capability") {
          const cap = captured.get(step.use ?? "");
          if (!cap?.capabilityId) throw new Error("no captured capability to revoke");
          const r = await revokeCapabilityViaGateway({
            credentialSecret: secretFor(cap.agent),
            capabilityId: cap.capabilityId,
            reason: "validation scenario",
          });
          await record({
            seq: steps.length,
            stepKey: step.id,
            kind: "fault",
            action: "revoke_capability",
            label: step.label,
            request: { capability: step.use },
            expected: {},
            actual: { reasonCodes: [], capability: "n/a", execution: "n/a", status: r.result ?? r.status },
            verdict: "pass",
            control: null,
            mismatches: [],
            latencyMs: Date.now() - stepStart,
            occurredAt: new Date().toISOString(),
            evidence: null,
          });
          continue;
        }

        const actual: StepActual = { reasonCodes: [], capability: "n/a", execution: "n/a" };
        let latency: number | null = null;
        let reqSummary = requestSummary(step.arguments);
        let authKey: string | null = null;

        if (
          step.action === "authorize" ||
          step.action === "authorize_execute" ||
          step.action === "reauthorize"
        ) {
          const prior = step.action === "reauthorize" ? authInputs.get(step.ref ?? "") : undefined;
          if (step.action === "reauthorize" && !prior)
            throw new Error(`reauthorize: unknown step ${step.ref}`);
          // `authorize` + `ref` = the SAME idempotency key with different content (a replay-with-change attempt).
          const sameKey = step.action === "authorize" && step.ref ? authInputs.get(step.ref)?.key : undefined;
          const input = prior ?? {
            actor,
            taskId: stepTaskId,
            tool,
            operation,
            resource: step.resource,
            args: step.arguments,
            key: sameKey ?? keyFor("auth"),
            maxUses: step.maxUses,
            registryVersion: step.registryVersionOverride,
            semantic: step.semantic,
          };
          if (!prior) authInputs.set(step.id, input);
          authKey = input.key;
          authKeyByStep.set(step.id, input.key);
          reqSummary = requestSummary(input.args, input.tool, input.resource);
          const a = await doAuthorize({ ...input, semantic: step.semantic ?? input.semantic });
          Object.assign(actual, a.actual);
          latency = a.latencyMs;
          if (a.token && step.capture)
            captured.set(step.capture, {
              token: a.token,
              capabilityId: a.capabilityId,
              tool: input.tool,
              operation: input.operation,
              resource: input.resource,
              args: input.args,
              agent: input.actor,
              taskId: input.taskId,
            });
          if (step.action === "authorize_execute" && a.token) {
            const cap: Captured = {
              token: a.token,
              capabilityId: a.capabilityId,
              tool: input.tool,
              operation: input.operation,
              resource: input.resource,
              args: input.args,
              agent: input.actor,
              taskId: input.taskId,
            };
            const key = keyFor("exec");
            lastExecKey = key;
            const e = await doExecute(cap, {
              tool: input.tool,
              operation: input.operation,
              resource: input.resource,
              args: input.args,
              key,
              step,
            });
            actual.execution = e.executed ? "executed" : "blocked";
            actual.resultCode = e.code;
            actual.httpStatus = e.http;
            if (e.executed) lastSuccessKey = key;
            actual.executedCount = e.executed ? 1 : 0;
            if (e.executed) lastSuccessKey = key;
            if (e.executed && !e.noop)
              effects.push({
                tool: input.tool,
                stepKey: step.id,
                description: `${input.tool} executed`,
                args: { ...input.args, _actor: actor },
                violates: null,
              });
            else if (e.executed)
              effects.push({
                tool: input.tool,
                stepKey: step.id,
                description: `${input.tool} (no-op)`,
                args: { ...input.args, _actor: actor },
                violates: null,
              });
          } else if (step.action === "authorize_execute") {
            actual.execution = "blocked";
          }
        } else if (step.action === "execute") {
          const cap = captured.get(step.use ?? "");
          if (!cap) throw new Error(`execute: no captured capability "${step.use}"`);
          const effTool = step.override?.tool ?? cap.tool;
          const effOperation =
            step.override?.operation ??
            (step.override?.tool ? step.override.tool.split(".")[1] : cap.operation);
          const effResource = step.override?.resource ?? cap.resource;
          const effArgs = {
            ...(step.override?.arguments ? { ...cap.args, ...step.override.arguments } : cap.args),
            ...(step.arguments ?? {}),
          };
          reqSummary = requestSummary(effArgs, effTool, effResource);
          const actorCap: Captured = { ...cap, agent: actor };
          const n = step.parallel ?? 1;
          const runs = await Promise.all(
            Array.from({ length: n }, async (_, i) => {
              await new Promise((r) => setTimeout(r, Math.floor(rng() * 20)));
              const key = step.sameKey && lastSuccessKey ? lastSuccessKey : keyFor(`exec${i}`);
              const out = await doExecute(actorCap, {
                tool: effTool,
                operation: effOperation,
                resource: effResource,
                args: effArgs,
                key,
                faultBeforeDispatch: step.faultBeforeDispatch,
                step,
              });
              if (out.executed && !out.replayed && !lastSuccessKey) lastSuccessKey = key;
              return out;
            }),
          );
          const executedRuns = runs.filter((r) => r.executed);
          actual.executedCount = executedRuns.length;
          actual.execution = executedRuns.length > 0 ? "executed" : "blocked";
          actual.replayed = runs.some((r) => r.replayed);
          actual.resultCode =
            runs.find((r) => r.code && r.code !== "REPLAYED")?.code ?? runs.find((r) => r.code)?.code ?? null;
          actual.httpStatus = runs[0]?.http ?? null;
          for (const r of executedRuns)
            if (!r.noop)
              effects.push({
                tool: effTool,
                stepKey: step.id,
                description: `${effTool} executed`,
                args: { ...effArgs, _actor: actor },
                violates: null,
              });
        }

        latency = latency ?? Date.now() - stepStart;
        const control = responsibleControl(actual);
        const mismatches = compareOutcome(step.expect, actual);
        const didLeak = leaked(step, actual);
        if (didLeak)
          for (const e of effects)
            if (e.stepKey === step.id && !e.violates)
              e.violates = "executed although the scenario required it to be blocked";
        await record({
          seq: steps.length,
          stepKey: step.id,
          kind: step.kind,
          action: step.action,
          label: step.label,
          request: reqSummary,
          expected: step.expect,
          actual,
          verdict: mismatches.length === 0 ? "pass" : "fail",
          control: actual.finalDecision !== undefined || actual.execution !== "n/a" ? control : null,
          mismatches,
          latencyMs: latency,
          occurredAt: new Date().toISOString(),
          evidence: { authKey, injected: step.injected ?? null },
        });
      } catch (error) {
        await record({
          seq: steps.length,
          stepKey: step.id,
          kind: step.kind,
          action: step.action,
          label: step.label,
          request: { tool, operation },
          expected: step.expect,
          actual: { reasonCodes: [], capability: "n/a", execution: "n/a" },
          verdict: "error",
          control: null,
          mismatches: [error instanceof Error ? error.message.slice(0, 200) : "step failed"],
          latencyMs: Date.now() - stepStart,
          occurredAt: new Date().toISOString(),
          evidence: null,
        });
      }
    }
    return finish("completed");

    function mkResult(
      step: AttackStep,
      actual: StepActual,
      verdict: StepResult["verdict"],
      mismatches: string[],
      control: Control | null,
      latency: number | null,
    ): StepResult {
      return {
        seq: steps.length,
        stepKey: step.id,
        kind: step.kind,
        action: step.action,
        label: step.label,
        request: null,
        expected: step.expect,
        actual,
        verdict,
        control,
        mismatches,
        latencyMs: latency,
        occurredAt: new Date().toISOString(),
        evidence: null,
      };
    }

    async function finish(status: RunResult["status"], errorCategory?: string): Promise<RunOutcome> {
      let evidence: vl.SandboxEvidence | null = null;
      try {
        evidence = await vl.sandboxEvidence(sandboxId);
      } catch {
        evidence = null;
      }
      // Attach the database's own record of each decision (semantic evidence, disagreement) to the steps.
      const byKey = new Map((evidence?.requests ?? []).map((r) => [r.idempotency_key, r]));
      for (const s of steps) {
        const k = authKeyByStep.get(s.stepKey);
        const row = k ? byKey.get(k) : undefined;
        if (row) {
          s.actual.semantic = {
            state: row.semantic_state,
            risk: row.semantic_risk,
            provider: row.semantic_provider,
            indicators: row.semantic_indicators ?? [],
            narrowed: Boolean(row.narrowed),
          };
          s.actual.deterministicDecision =
            toDecision(row.deterministic_outcome) ?? s.actual.deterministicDecision;
        }
      }
      for (const e of effects) {
        const rule = scenario.boundary.find((b) => matchesRule(e, b));
        if (rule) e.violates = rule.description;
      }
      const metrics = computeMetrics(scenario, steps, effects, evidence, effective);
      const violated = effects.some((e) => e.violates);
      const anyFail = steps.some((s) => s.verdict !== "pass" && s.verdict !== "skipped");
      const verdict: RunResult["verdict"] =
        status === "error"
          ? "error"
          : status === "cancelled"
            ? "error"
            : anyFail || violated
              ? steps.some((s) => s.verdict === "error") &&
                !steps.some((s) => s.verdict === "fail") &&
                !violated
                ? "error"
                : "fail"
              : "pass";
      const destroyed = await destroyAll();
      return {
        result: {
          scenarioKey: scenario.key,
          scenarioVersion: scenario.version,
          variant: opts.variant,
          repetition: opts.repetition,
          seed: opts.seed,
          status,
          verdict,
          steps,
          effects,
          metrics,
          errorCategory,
          durationMs: Date.now() - started,
        },
        effective,
        resolved: scenario,
        sandboxDestroyed: destroyed,
      };
    }
  } catch (error) {
    if (error instanceof ScenarioAuthoringError) throw error;
    await destroyAll();
    return {
      ...empty(
        "error",
        "error",
        error instanceof Error && /sandbox/i.test(error.message) ? "sandbox" : "engine",
      ),
      sandboxDestroyed: true,
    };
  } finally {
    await destroyAll();
  }

  async function destroyAll(): Promise<boolean> {
    let ok = true;
    for (const id of sandboxIds.splice(0)) {
      try {
        await vl.destroySandbox(id);
      } catch {
        ok = false; // the sandbox has a hard expiry and is swept by the maintenance job
      }
    }
    return ok;
  }
}

function computeMetrics(
  scenario: Scenario,
  steps: StepResult[],
  effects: EffectRecord[],
  evidence: vl.SandboxEvidence | null,
  effective: EffectiveContract,
): RunMetrics {
  const m = emptyMetrics();
  const defs = new Map(scenario.steps.map((s) => [s.id, s]));
  const controls = new Set<Control>();
  let firstBlock: number | null = null;
  const t0 = steps.length ? Date.parse(steps[0].occurredAt) : 0;
  const exercised = new Set<string>();

  for (const s of steps) {
    const def = defs.get(s.stepKey);
    if (!def || s.kind === "fault") continue;
    if (
      s.actual.finalDecision !== undefined &&
      s.actual.finalDecision !== null &&
      s.latencyMs !== null &&
      s.action !== "execute"
    )
      m.authorizeLatenciesMs.push(s.latencyMs);
    if (s.control && s.control !== "none") controls.add(s.control);
    if (s.kind === "baseline" || s.kind === "control") {
      m.benignSteps += 1;
      if (falsePositive(def, s.actual)) m.benignBlocked += 1;
      if (s.actual.execution === "executed" || s.actual.capability === "issued")
        exercised.add(String(s.request?.tool ?? ""));
    } else {
      m.attackSteps += 1;
      if (leaked(def, s.actual)) m.attackAllowed += 1;
      else {
        m.attackBlocked += 1;
        if (firstBlock === null) firstBlock = Math.max(0, Date.parse(s.occurredAt) - t0) + (s.latencyMs ?? 0);
      }
      if (
        def.action === "execute" &&
        (scenario.category === "capability_replay" ||
          scenario.category === "capability_theft" ||
          scenario.category === "capability_broadening")
      ) {
        m.replayAttempts += 1;
        if (!leaked(def, s.actual)) m.replayBlocked += 1;
      }
      if (scenario.category === "stale_approval" || scenario.category === "approval_bypass") {
        m.approvalBypassAttempts += 1;
        if (!leaked(def, s.actual)) m.approvalBypassBlocked += 1;
      }
    }
  }
  m.unauthorizedEffects = effects.filter((e) => e.violates).length;
  m.timeToFirstBlockMs = firstBlock !== null && firstBlock >= 0 ? firstBlock : null;
  m.controlsExercised = [...controls];
  m.unusedAuthority = {
    allowedTools: effective.allowedActions.length,
    exercisedTools: effective.allowedActions.filter((a) => exercised.has(a.tool)).length,
  };
  for (const r of evidence?.requests ?? []) {
    if (r.semantic_risk && r.deterministic_outcome && r.semantic_state === "ok") {
      const d = classifyDisagreement(r.deterministic_outcome as never, r.semantic_risk as never);
      if (d !== "none") m.disagreements += 1;
    }
  }
  return m;
}
