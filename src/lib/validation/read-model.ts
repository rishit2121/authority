import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { COMPILER_VERSION } from "@/lib/authorization/contract-compiler";
import { GATEWAY_VERSION } from "@/lib/gateway/pipeline";
import type { Database, Json } from "@/lib/supabase/database.types";

import { registry } from "./engine/compile";
import type { CampaignMetrics } from "./metrics";
import type { ReportInput } from "./report";
import {
  environmentSpecSchema,
  remediationProposalSchema,
  scenarioSchema,
  type Control,
  type FindingDraft,
  type RemediationProposal,
  type RunMetrics,
  type RunResult,
  type Scenario,
  type Severity,
  type StepResult,
} from "./schema";

type Db = SupabaseClient<Database>;

export interface StepView {
  id: string;
  seq: number;
  stepKey: string;
  kind: StepResult["kind"];
  action: string;
  label: string;
  request: Record<string, unknown> | null;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  verdict: StepResult["verdict"];
  control: string | null;
  latencyMs: number | null;
  mismatches: string[];
  evidence: Record<string, unknown> | null;
  occurredAt: string;
}

export interface RunView {
  id: string;
  scenarioKey: string;
  scenarioVersion: number;
  variant: string;
  repetition: number;
  seed: number;
  status: string;
  verdict: string | null;
  title: string;
  category: string;
  severity: Severity;
  intent: string;
  metrics: RunMetrics | null;
  effects: Array<{ tool: string; stepKey: string; description: string; violates: string | null }>;
  startedAt: string;
  finishedAt: string | null;
  steps: StepView[];
  plan: Array<{ id: string; tool: string }>;
}

export interface FindingView {
  id: string;
  runId: string;
  scenarioKey: string;
  severity: Severity;
  category: string;
  cause: string;
  title: string;
  summary: string;
  status: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface RemediationView {
  id: string;
  findingId: string;
  kind: string;
  status: string;
  proposal: Record<string, unknown>;
  decidedAt: string | null;
  decisionNote: string | null;
  beforeRunId: string | null;
  afterRunId: string | null;
  verification: Record<string, unknown> | null;
  createdAt: string;
}

export interface CampaignView {
  id: string;
  name: string;
  status: string;
  seed: number;
  packKey: string | null;
  environmentId: string;
  progress: { total: number; done: number; current?: string | null };
  summary: Record<string, unknown> | null;
  config: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const asObj = (v: Json | null | undefined): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function toCampaignView(
  row: Database["public"]["Tables"]["validation_campaigns"]["Row"],
): CampaignView {
  const p = asObj(row.progress);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    seed: Number(row.seed),
    packKey: row.pack_key,
    environmentId: row.environment_id,
    progress: {
      total: Number(p.total ?? 0),
      done: Number(p.done ?? 0),
      current: (p.current as string | null | undefined) ?? null,
    },
    summary: row.summary ? asObj(row.summary) : null,
    config: asObj(row.config),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function toFindingView(row: Database["public"]["Tables"]["validation_findings"]["Row"]): FindingView {
  return {
    id: row.id,
    runId: row.run_id,
    scenarioKey: row.scenario_key,
    severity: row.severity as Severity,
    category: row.category,
    cause: row.cause,
    title: row.title,
    summary: row.summary,
    status: row.status,
    evidence: asObj(row.evidence),
    createdAt: row.created_at,
  };
}

export function toRemediationView(
  row: Database["public"]["Tables"]["validation_remediations"]["Row"],
): RemediationView {
  return {
    id: row.id,
    findingId: row.finding_id,
    kind: row.kind,
    status: row.status,
    proposal: asObj(row.proposal),
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    beforeRunId: row.before_run_id,
    afterRunId: row.after_run_id,
    verification: row.verification ? asObj(row.verification) : null,
    createdAt: row.created_at,
  };
}

function toStepView(row: Database["public"]["Tables"]["validation_steps"]["Row"]): StepView {
  const evidence = row.evidence ? asObj(row.evidence) : null;
  const mismatches = Array.isArray(evidence?.mismatches) ? (evidence.mismatches as string[]) : [];
  return {
    id: row.id,
    seq: row.seq,
    stepKey: row.step_key,
    kind: row.kind as StepResult["kind"],
    action: row.action,
    label: row.label,
    request: row.request ? asObj(row.request) : null,
    expected: asObj(row.expected),
    actual: asObj(row.actual),
    verdict: row.verdict as StepResult["verdict"],
    control: row.control,
    latencyMs: row.latency_ms,
    mismatches,
    evidence,
    occurredAt: row.occurred_at,
  };
}

export async function loadRunsWithSteps(db: Db, campaignId: string): Promise<RunView[]> {
  const { data: runs } = await db
    .from("validation_runs")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("started_at", { ascending: true })
    .limit(600);
  if (!runs?.length) return [];
  const versionIds = [...new Set(runs.map((r) => r.scenario_version_id))];
  const [{ data: versions }, { data: steps }] = await Promise.all([
    db.from("validation_scenario_versions").select("id, definition").in("id", versionIds),
    db
      .from("validation_steps")
      .select("*")
      .in(
        "run_id",
        runs.map((r) => r.id),
      )
      .order("seq", { ascending: true })
      .limit(20000),
  ]);
  const defs = new Map<string, Scenario>();
  for (const v of versions ?? []) {
    const parsed = scenarioSchema.safeParse(v.definition);
    if (parsed.success) defs.set(v.id, parsed.data);
  }
  const stepsByRun = new Map<string, StepView[]>();
  for (const s of steps ?? []) {
    const list = stepsByRun.get(s.run_id) ?? [];
    list.push(toStepView(s));
    stepsByRun.set(s.run_id, list);
  }
  return runs.map((r) => {
    const def = defs.get(r.scenario_version_id);
    return {
      id: r.id,
      scenarioKey: r.scenario_key,
      scenarioVersion: r.scenario_version,
      variant: r.variant,
      repetition: r.repetition,
      seed: Number(r.seed),
      status: r.status,
      verdict: r.verdict,
      title: def?.title ?? r.scenario_key,
      category: def?.category ?? "unknown",
      severity: (def?.severity ?? "info") as Severity,
      intent: def?.intent ?? "",
      metrics: r.metrics ? (r.metrics as unknown as RunMetrics) : null,
      effects: Array.isArray(r.effects) ? (r.effects as unknown as RunView["effects"]) : [],
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      steps: stepsByRun.get(r.id) ?? [],
      plan: def?.plan.map((n) => ({ id: n.id, tool: n.tool })) ?? [],
    };
  });
}

/** Rebuilds a downloadable report purely from persisted rows (what the UI shows is what the report says). */
export async function buildReportInputFromDb(db: Db, campaignId: string): Promise<ReportInput | null> {
  const { data: c } = await db.from("validation_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!c) return null;
  const campaign = toCampaignView(c);
  const [{ data: env }, runs, { data: findings }, { data: regs }] = await Promise.all([
    db.from("validation_environments").select("name, spec").eq("id", c.environment_id).maybeSingle(),
    loadRunsWithSteps(db, campaignId),
    db.from("validation_findings").select("*").eq("campaign_id", campaignId).limit(500),
    db
      .from("validation_regressions")
      .select("scenario_key, last_status, last_run_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const findingIds = (findings ?? []).map((f) => f.id);
  const { data: rems } = findingIds.length
    ? await db.from("validation_remediations").select("*").in("finding_id", findingIds)
    : { data: [] };
  const remsByFinding = new Map<string, RemediationProposal[]>();
  for (const r of rems ?? []) {
    const parsed = remediationProposalSchema.safeParse(r.proposal);
    if (parsed.success)
      remsByFinding.set(r.finding_id, [...(remsByFinding.get(r.finding_id) ?? []), parsed.data]);
  }
  const spec = environmentSpecSchema.safeParse(env?.spec ?? { schemaVersion: 1 });
  const limits = spec.success ? spec.data.limits : environmentSpecSchema.parse({ schemaVersion: 1 }).limits;
  const summary = campaign.summary ?? {};
  const metrics = (summary.metrics ?? null) as CampaignMetrics | null;
  if (!metrics) return null;

  const emptyMetrics: RunMetrics = {
    attackSteps: 0,
    attackBlocked: 0,
    attackAllowed: 0,
    benignSteps: 0,
    benignBlocked: 0,
    unauthorizedEffects: 0,
    disagreements: 0,
    replayAttempts: 0,
    replayBlocked: 0,
    approvalBypassAttempts: 0,
    approvalBypassBlocked: 0,
    authorizeLatenciesMs: [],
    timeToFirstBlockMs: null,
    unusedAuthority: { allowedTools: 0, exercisedTools: 0 },
    controlsExercised: [],
  };
  const started = campaign.startedAt ?? campaign.createdAt;
  const finished = campaign.finishedAt ?? new Date().toISOString();
  return {
    title: campaign.name,
    environment: {
      name: env?.name ?? "environment",
      sandboxMinutes: spec.success ? spec.data.sandboxMinutes : 15,
      limits: limits as unknown as Record<string, number>,
    },
    campaign: {
      id: campaign.id,
      status: campaign.status,
      seed: campaign.seed,
      startedAt: started,
      finishedAt: finished,
      durationMs: Number(summary.durationMs ?? Date.parse(finished) - Date.parse(started)),
      pack: campaign.packKey,
      variants: Array.isArray(campaign.config.variants)
        ? (campaign.config.variants as string[])
        : ["baseline"],
      truncated: Boolean(summary.truncated),
      notes: Array.isArray(summary.notes) ? (summary.notes as string[]) : [],
    },
    versions: { gateway: GATEWAY_VERSION, registry: registry.registryVersion, compiler: COMPILER_VERSION },
    runs: runs.map((r) => {
      const result: RunResult = {
        scenarioKey: r.scenarioKey,
        scenarioVersion: r.scenarioVersion,
        variant: r.variant,
        repetition: r.repetition,
        seed: r.seed,
        status: r.status === "running" ? "error" : (r.status as RunResult["status"]),
        verdict: (r.verdict ?? "error") as RunResult["verdict"],
        steps: r.steps.map((s) => ({
          seq: s.seq,
          stepKey: s.stepKey,
          kind: s.kind,
          action: s.action,
          label: s.label,
          request: s.request,
          expected: s.expected as unknown as StepResult["expected"],
          actual: s.actual as unknown as StepResult["actual"],
          verdict: s.verdict,
          control: (s.control as Control | null) ?? null,
          mismatches: s.mismatches,
          latencyMs: s.latencyMs,
          occurredAt: s.occurredAt,
          evidence: s.evidence,
        })),
        effects: r.effects.map((e) => ({ ...e, args: {} })),
        metrics: r.metrics ?? emptyMetrics,
        durationMs: r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : 0,
      };
      const tools = [...new Set(r.plan.map((n) => n.tool))];
      return {
        result,
        title: r.title,
        category: r.category,
        severity: r.severity,
        intent: r.intent,
        taxonomy: [],
        controls: [...new Set(r.steps.map((s) => s.control).filter((x): x is string => !!x && x !== "none"))],
        effectiveAuthority: { tools, semanticMode: "per scenario", approvalClasses: [] },
      };
    }),
    findings: (findings ?? []).map((f) => {
      const v = toFindingView(f);
      return {
        scenarioKey: v.scenarioKey,
        runKey: v.runId,
        stepSeq: 0,
        severity: v.severity,
        category: v.category,
        cause: v.cause,
        title: v.title,
        summary: v.summary,
        evidence: v.evidence,
        remediations: remsByFinding.get(f.id) ?? [],
      } as unknown as FindingDraft;
    }),
    metrics,
    regressions: (regs ?? []).map((g) => ({
      key: g.scenario_key,
      status: g.last_status,
      lastRunAt: g.last_run_at,
    })),
  };
}
