import type { ReactNode } from "react";

import { Panel } from "@/components/task/panels";
import { githubReadiness } from "@/lib/github/config";
import type {
  ReceiptView,
  RepositoryView,
  ReservationView,
  RuntimeApprovalView,
} from "@/lib/github/read-model";

import { BindRepositoryForm, ResolveIndeterminateForm } from "./GithubControls";
import { ExecutionFlowGraph, type FlowPhase, type FlowStep } from "./ExecutionFlowGraph";
import { ModeBadge } from "./ModeBadge";

export interface ContractGithubAction {
  tool: string;
  constraints: Array<{ key: string; equals?: string; matches?: string }>;
}

export interface TaskGithubData {
  taskId: string;
  canBind: boolean;
  canResolve: boolean;
  bound: (RepositoryView & { installationStatus: string; installationMode: string }) | null;
  allowedRepositories: RepositoryView[];
  actions: ContractGithubAction[];
  reservations: ReservationView[];
  receipts: ReceiptView[];
  approvals: RuntimeApprovalView[];
  flow: FlowStep[];
}

const STATE_TONE: Record<string, string> = {
  consumed: "text-allow",
  reserved: "text-primary",
  released: "text-on-surface-variant",
  failed: "text-deny",
  indeterminate: "text-secondary",
};

const shortSha = (s: string | null) => (s ? s.slice(0, 7) : "—");

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">{label}</dt>
      <dd className="mt-0.5 text-on-surface-variant">{children}</dd>
    </div>
  );
}

const EXPLAIN: Record<string, string> = {
  indeterminate:
    "Outcome unknown: the request may or may not have reached GitHub. It was NOT retried. Inspect GitHub before requesting again.",
  failed: "GitHub definitively refused or could not complete the request. The capability use is spent.",
  released: "The request was never sent. The capability use was returned.",
};

export function GithubTaskPanel({ data }: { data: TaskGithubData }) {
  const readiness = githubReadiness();
  const receiptFor = (executionId: string) => data.receipts.find((r) => r.executionId === executionId);

  return (
    <Panel
      id="github"
      title="GitHub execution"
      subtitle="Repository binding, authorized operations, capability state and receipts"
      accent="cyan"
    >
      <div className="flex flex-col gap-space-lg" data-testid="github-task-panel">
        <div className="flex flex-wrap items-center gap-space-sm">
          <ModeBadge mode={data.bound ? (data.bound.installationMode as "mock" | "live") : readiness.mode} />
          <span className="font-body-sm text-body-sm text-outline">
            {(data.bound?.installationMode ?? readiness.mode) === "mock"
              ? "Simulated: no request reaches GitHub. Receipts below are from the mock."
              : "Live: requests are made to api.github.com through the connector."}
          </span>
        </div>

        <section aria-labelledby="bind-heading">
          <h3 id="bind-heading" className="font-headline-sm text-body-lg font-semibold text-on-surface">
            Repository binding
          </h3>
          {data.bound ? (
            <dl
              className="mt-space-sm grid grid-cols-2 gap-space-md sm:grid-cols-4"
              data-testid="bound-repository"
            >
              <Row label="Repository">
                <span className="font-mono-code text-[12px] text-on-surface">{data.bound.fullName}</span>
              </Row>
              <Row label="Default branch">{data.bound.defaultBranch} (never writable)</Row>
              <Row label="Allowlisted">{data.bound.allowed ? "yes" : "no"}</Row>
              <Row label="Installation">{data.bound.installationStatus}</Row>
            </dl>
          ) : data.canBind ? (
            <div className="mt-space-sm">
              <BindRepositoryForm taskId={data.taskId} repositories={data.allowedRepositories} />
            </div>
          ) : (
            <p className="mt-space-sm font-body-sm text-body-sm text-outline">
              This task has no repository. Developers and above can bind one.
            </p>
          )}
        </section>

        <section aria-labelledby="ops-heading">
          <h3 id="ops-heading" className="font-headline-sm text-body-lg font-semibold text-on-surface">
            Authorized GitHub operations
          </h3>
          {data.actions.length === 0 ? (
            <p className="mt-space-sm font-body-sm text-body-sm text-outline">
              The active contract authorizes no GitHub operation.
            </p>
          ) : (
            <ul className="mt-space-sm flex flex-col gap-1.5" data-testid="contract-github-actions">
              {data.actions.map((a) => (
                <li key={a.tool} className="font-mono-code text-[12px] text-on-surface-variant">
                  <span className="text-on-surface">{a.tool}</span> on{" "}
                  <span className="text-primary">{data.bound?.fullName ?? "(no repository bound)"}</span>
                  {a.constraints.length
                    ? ` — ${a.constraints.map((c) => `${c.key} ${c.equals !== undefined ? `= ${c.equals}` : `~ ${c.matches}`}`).join(", ")}`
                    : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 font-body-sm text-body-sm text-outline">
            Writes are limited to branches under{" "}
            <code className="font-mono-code">authority/&lt;task&gt;/…</code>; the default branch and protected
            branches are never writable.
          </p>
        </section>

        {data.approvals.length > 0 ? (
          <section aria-labelledby="appr-heading">
            <h3 id="appr-heading" className="font-headline-sm text-body-lg font-semibold text-on-surface">
              Runtime approvals
            </h3>
            <ul className="mt-space-sm flex flex-col gap-1.5" data-testid="task-approvals">
              {data.approvals.map((a) => (
                <li key={a.id} className="font-body-sm text-body-sm text-on-surface-variant">
                  <span className="font-mono-code text-[12px] text-on-surface">{a.tool}</span> —{" "}
                  <span data-testid={`approval-state-${a.status}`}>{a.status}</span>
                  {` (${a.approvals}/${a.requiredApprovals} approvals${a.staleReason ? `, ${a.staleReason}` : ""})`}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="flow-heading">
          <h3 id="flow-heading" className="font-headline-sm text-body-lg font-semibold text-on-surface">
            Execution flow
          </h3>
          <div className="mt-space-sm">
            <ExecutionFlowGraph steps={data.flow} />
          </div>
        </section>

        <section aria-labelledby="exec-heading">
          <h3 id="exec-heading" className="font-headline-sm text-body-lg font-semibold text-on-surface">
            Executions and receipts
          </h3>
          {data.reservations.length === 0 ? (
            <p className="mt-space-sm font-body-sm text-body-sm text-outline" data-testid="no-executions">
              No GitHub execution has been attempted for this task.
            </p>
          ) : (
            <ul className="mt-space-sm flex flex-col gap-space-md" data-testid="execution-list">
              {data.reservations.map((r) => {
                const receipt = receiptFor(r.id);
                const url =
                  receipt && typeof receipt.resourceIds.htmlUrl === "string"
                    ? (receipt.resourceIds.htmlUrl as string)
                    : null;
                return (
                  <li
                    key={r.id}
                    data-testid={`execution-${r.status}`}
                    className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-space-md"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-space-sm">
                      <span className="font-mono-code text-[12px] text-on-surface">{r.tool}</span>
                      <div className="flex items-center gap-space-sm">
                        <ModeBadge mode={r.mode} />
                        <span
                          data-testid="execution-status"
                          className={`font-mono-code text-[11px] uppercase ${STATE_TONE[r.status] ?? ""}`}
                        >
                          {r.status}
                        </span>
                      </div>
                    </div>
                    <dl className="mt-space-sm grid grid-cols-2 gap-space-sm sm:grid-cols-4">
                      <Row label="Execution">
                        <span className="font-mono-code text-[11px]">{r.id.slice(0, 8)}</span>
                      </Row>
                      <Row label="Repository">{r.repository ?? "—"}</Row>
                      <Row label="Lease">
                        {r.status === "reserved"
                          ? `until ${new Date(r.leaseExpiresAt).toLocaleTimeString()}`
                          : "settled"}
                      </Row>
                      <Row label="Reason">{r.reasonCode ?? "—"}</Row>
                    </dl>
                    {receipt ? (
                      <dl
                        className="mt-space-sm grid grid-cols-2 gap-space-sm border-t border-outline-variant/20 pt-space-sm sm:grid-cols-4"
                        data-testid="receipt"
                      >
                        <Row label="Result">{receipt.resultCategory.replace("_", " ")}</Row>
                        <Row label="GitHub request id">
                          <span className="font-mono-code text-[11px]">{receipt.githubRequestId ?? "—"}</span>
                        </Row>
                        <Row label="Before → after">
                          <span className="font-mono-code text-[11px]">
                            {shortSha(receipt.beforeSha)} → {shortSha(receipt.afterSha)}
                          </span>
                        </Row>
                        <Row label="Resource">
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid="pr-link"
                              className="font-mono-code text-[11px] text-primary underline"
                            >
                              {url.replace("https://github.com/", "")}
                            </a>
                          ) : (
                            <span className="font-mono-code text-[11px]">
                              {["branch", "path", "pullNumber", "issueNumber"]
                                .map((k) =>
                                  receipt.resourceIds[k] !== undefined
                                    ? `${k}=${String(receipt.resourceIds[k])}`
                                    : null,
                                )
                                .filter(Boolean)
                                .join(" ") || "—"}
                            </span>
                          )}
                        </Row>
                      </dl>
                    ) : null}
                    {EXPLAIN[r.status] ? (
                      <p
                        className="mt-space-sm font-body-sm text-body-sm text-on-surface-variant"
                        data-testid="execution-explain"
                      >
                        {EXPLAIN[r.status]}
                      </p>
                    ) : null}
                    {r.status === "indeterminate" ? (
                      r.resolvedOutcome ? (
                        <p
                          className="mt-space-sm font-body-sm text-body-sm text-on-surface"
                          data-testid="resolution"
                        >
                          Resolved by an operator: {r.resolvedOutcome.replace("_", " ")}
                          {r.resolutionNote ? ` — ${r.resolutionNote}` : ""}. The capability use stays spent.
                        </p>
                      ) : data.canResolve ? (
                        <div className="mt-space-sm">
                          <ResolveIndeterminateForm taskId={data.taskId} executionId={r.id} />
                        </div>
                      ) : null
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  );
}

export type { FlowPhase };
