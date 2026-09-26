import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export interface InstallationView {
  id: string;
  githubInstallationId: number;
  mode: "mock" | "live";
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  grantedPermissions: Record<string, string>;
  status: "active" | "suspended" | "permission_drift" | "disconnected";
  healthReasons: string[];
  lastVerifiedAt: string | null;
  connectedAt: string;
}

export interface RepositoryView {
  id: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  archived: boolean;
  present: boolean;
  allowed: boolean;
}

export async function loadGithubOverview(supabase: Client) {
  const { data: inst } = await supabase
    .from("github_installations")
    .select(
      "id, github_installation_id, mode, account_login, account_type, repository_selection, granted_permissions, status, health_reasons, last_verified_at, connected_at",
    )
    .neq("status", "disconnected")
    .maybeSingle();
  const installation: InstallationView | null = inst
    ? {
        id: inst.id,
        githubInstallationId: inst.github_installation_id,
        mode: inst.mode as "mock" | "live",
        accountLogin: inst.account_login,
        accountType: inst.account_type,
        repositorySelection: inst.repository_selection,
        grantedPermissions: (inst.granted_permissions ?? {}) as Record<string, string>,
        status: inst.status as InstallationView["status"],
        healthReasons: inst.health_reasons,
        lastVerifiedAt: inst.last_verified_at,
        connectedAt: inst.connected_at,
      }
    : null;

  const repositories: RepositoryView[] = [];
  if (installation) {
    const { data } = await supabase
      .from("github_repositories")
      .select("id, owner, name, default_branch, is_private, archived, present, allowed")
      .eq("installation_row_id", installation.id)
      .order("owner")
      .order("name");
    for (const r of data ?? []) {
      repositories.push({
        id: r.id,
        fullName: `${r.owner}/${r.name}`,
        defaultBranch: r.default_branch,
        isPrivate: r.is_private,
        archived: r.archived,
        present: r.present,
        allowed: r.allowed,
      });
    }
  }
  return { installation, repositories };
}

export interface ReservationView {
  id: string;
  tool: string;
  status: "reserved" | "consumed" | "released" | "failed" | "indeterminate";
  mode: "mock" | "live";
  repository: string | null;
  reservedAt: string;
  leaseExpiresAt: string;
  dispatchedAt: string | null;
  finishedAt: string | null;
  reasonCode: string | null;
  resolvedOutcome: string | null;
  resolutionNote: string | null;
}

export interface ReceiptView {
  id: string;
  executionId: string;
  tool: string;
  mode: "mock" | "live";
  resultCategory: string;
  repository: string | null;
  githubRequestId: string | null;
  httpStatusClass: number | null;
  resourceIds: Record<string, unknown>;
  beforeSha: string | null;
  afterSha: string | null;
  startedAt: string;
  finishedAt: string;
  reasonCode: string | null;
}

export interface RuntimeApprovalView {
  id: string;
  taskId: string;
  tool: string;
  resource: string | null;
  riskClass: string;
  trigger: string;
  status: string;
  staleReason: string | null;
  requiredApprovals: number;
  approvals: number;
  createdAt: string;
  expiresAt: string;
  evidence: {
    reasonCodes?: string[];
    semantic?: { state?: string; riskLevel?: string; indicators?: string[] } | null;
    deterministicOutcome?: string;
  };
  contractVersion: number;
  decidedBy: Array<{ principalId: string; decision: string; note: string | null; at: string }>;
}

export async function loadRuntimeApprovals(
  supabase: Client,
  taskId?: string,
): Promise<RuntimeApprovalView[]> {
  let q = supabase
    .from("runtime_approval_requests")
    .select(
      "id, task_id, tool, resource, risk_class, trigger_kind, status, stale_reason, required_approvals, created_at, expires_at, evidence, contract_version",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (taskId) q = q.eq("task_id", taskId);
  const { data } = await q;
  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  const { data: decisions } = ids.length
    ? await supabase
        .from("runtime_approval_decisions")
        .select("request_id, approver_principal_id, decision, note, created_at")
        .in("request_id", ids)
    : { data: [] };
  return rows.map((r) => {
    const ds = (decisions ?? []).filter((d) => d.request_id === r.id);
    return {
      id: r.id,
      taskId: r.task_id,
      tool: r.tool,
      resource: r.resource,
      riskClass: r.risk_class,
      trigger: r.trigger_kind,
      status: r.status === "pending" && new Date(r.expires_at) <= new Date() ? "expired" : r.status,
      staleReason: r.stale_reason,
      requiredApprovals: r.required_approvals,
      approvals: ds.filter((d) => d.decision === "approve").length,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      evidence: (r.evidence ?? {}) as RuntimeApprovalView["evidence"],
      contractVersion: r.contract_version,
      decidedBy: ds.map((d) => ({
        principalId: d.approver_principal_id,
        decision: d.decision,
        note: d.note,
        at: d.created_at,
      })),
    };
  });
}

export async function loadTaskGithub(supabase: Client, taskId: string) {
  const { data: binding } = await supabase
    .from("task_repository_bindings")
    .select("repository_id, created_at")
    .eq("task_id", taskId)
    .maybeSingle();
  let boundRepository: (RepositoryView & { installationStatus: string; installationMode: string }) | null =
    null;
  if (binding) {
    const { data: r } = await supabase
      .from("github_repositories")
      .select("id, owner, name, default_branch, is_private, archived, present, allowed, installation_row_id")
      .eq("id", binding.repository_id)
      .single();
    if (r) {
      const { data: gi } = await supabase
        .from("github_installations")
        .select("status, mode")
        .eq("id", r.installation_row_id)
        .single();
      boundRepository = {
        id: r.id,
        fullName: `${r.owner}/${r.name}`,
        defaultBranch: r.default_branch,
        isPrivate: r.is_private,
        archived: r.archived,
        present: r.present,
        allowed: r.allowed,
        installationStatus: gi?.status ?? "unknown",
        installationMode: gi?.mode ?? "mock",
      };
    }
  }

  const { data: res } = await supabase
    .from("capability_reservations")
    .select(
      "id, tool, status, execution_mode, repository_full_name, reserved_at, lease_expires_at, dispatched_at, finished_at, reason_code, resolved_outcome, resolution_note",
    )
    .eq("task_id", taskId)
    .order("reserved_at", { ascending: true })
    .limit(100);
  const reservations: ReservationView[] = (res ?? []).map((r) => ({
    id: r.id,
    tool: r.tool,
    status: r.status as ReservationView["status"],
    mode: r.execution_mode as "mock" | "live",
    repository: r.repository_full_name,
    reservedAt: r.reserved_at,
    leaseExpiresAt: r.lease_expires_at,
    dispatchedAt: r.dispatched_at,
    finishedAt: r.finished_at,
    reasonCode: r.reason_code,
    resolvedOutcome: r.resolved_outcome,
    resolutionNote: r.resolution_note,
  }));

  const { data: rc } = await supabase
    .from("github_execution_receipts")
    .select(
      "id, execution_id, tool, execution_mode, result_category, repository_full_name, github_request_id, http_status_class, resource_ids, before_sha, after_sha, started_at, finished_at, reason_code",
    )
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .limit(100);
  const receipts: ReceiptView[] = (rc ?? []).map((r) => ({
    id: r.id,
    executionId: r.execution_id,
    tool: r.tool,
    mode: r.execution_mode as "mock" | "live",
    resultCategory: r.result_category,
    repository: r.repository_full_name,
    githubRequestId: r.github_request_id,
    httpStatusClass: r.http_status_class,
    resourceIds: (r.resource_ids ?? {}) as Record<string, unknown>,
    beforeSha: r.before_sha,
    afterSha: r.after_sha,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    reasonCode: r.reason_code,
  }));

  const { data: repos } = await supabase
    .from("github_repositories")
    .select("id, owner, name, default_branch, is_private, archived, present, allowed")
    .eq("allowed", true)
    .eq("present", true)
    .order("owner")
    .order("name");
  const allowedRepositories: RepositoryView[] = (repos ?? []).map((r) => ({
    id: r.id,
    fullName: `${r.owner}/${r.name}`,
    defaultBranch: r.default_branch,
    isPrivate: r.is_private,
    archived: r.archived,
    present: r.present,
    allowed: r.allowed,
  }));

  return { boundRepository, reservations, receipts, allowedRepositories };
}
