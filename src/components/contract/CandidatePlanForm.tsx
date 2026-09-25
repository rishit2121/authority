"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  proposeContractAction,
  validateCandidatePlanAction,
  type ProposeContractPreview,
  type ValidatePlanResult,
} from "@/app/app/tasks/[taskId]/contract/actions";
import { Icon } from "@/components/ui/Icon";

function exampleCandidatePlan(taskId: string): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      taskId,
      nodes: [
        {
          id: "read-issue",
          sequence: 0,
          tool: "github.get_issue",
          arguments: { issue_number: "991" },
          dependencies: [],
          declaredOutputs: ["issue_title"],
          dataFlowRefs: [],
          expectedSideEffect: "read",
          maxInvocations: 1,
        },
        {
          id: "create-branch",
          sequence: 1,
          tool: "github.create_branch",
          arguments: { repository: "payments-api", branch: "fix-991" },
          dependencies: ["read-issue"],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "write_create",
          maxInvocations: 1,
        },
        {
          id: "push-commit",
          sequence: 2,
          tool: "github.push_commit",
          arguments: { repository: "payments-api", branch: "fix-991" },
          dependencies: ["create-branch"],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "write_update",
          maxInvocations: 3,
        },
        {
          id: "get-secret",
          sequence: 3,
          tool: "github.get_repository_secrets",
          arguments: { repository: "payments-api" },
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "read",
          maxInvocations: 1,
        },
      ],
    },
    null,
    2,
  );
}

const STATUS_STYLE: Record<string, string> = {
  accepted: "border-allow/30 bg-allow/10 text-allow",
  denied: "border-deny/30 bg-deny/10 text-deny",
  requires_review: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  clarify: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
  replan: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export function CandidatePlanForm({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [planText, setPlanText] = useState(exampleCandidatePlan(taskId));
  const [validation, setValidation] = useState<ValidatePlanResult | null>(null);
  const [proposal, setProposal] = useState<ProposeContractPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadExample() {
    setPlanText(exampleCandidatePlan(taskId));
    setValidation(null);
    setProposal(null);
    setError(null);
  }

  function handleValidate() {
    setError(null);
    setProposal(null);
    startTransition(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(planText);
      } catch {
        setError("That isn't valid JSON.");
        return;
      }
      const result = await validateCandidatePlanAction(taskId, parsed);
      if (result.ok && result.data) {
        setValidation(result.data);
      } else {
        setError(result.error ?? "Could not validate the candidate plan.");
      }
    });
  }

  function handlePropose() {
    setError(null);
    startTransition(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(planText);
      } catch {
        setError("That isn't valid JSON.");
        return;
      }
      const result = await proposeContractAction(taskId, parsed);
      if (result.ok && result.data) {
        setProposal(result.data);
      } else {
        setError(result.error ?? "Could not propose a contract.");
      }
    });
  }

  const hasAccepted = (validation?.acceptedNodeIds.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-space-lg">
      <div
        role="note"
        className="flex items-start gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5"
      >
        <Icon name="verified_user" size={15} className="mt-0.5 shrink-0 text-outline" />
        <p className="font-body-md text-body-sm text-on-surface-variant">
          Structural validation checks the plan mechanically — it cannot prove the plan matches your intent in
          prose. Anything unresolved is flagged for review, clarification, or replanning rather than silently
          accepted.
        </p>
      </div>

      <div className="flex flex-col gap-space-xs">
        <div className="flex items-center justify-between">
          <label
            htmlFor="candidate-plan-json"
            className="font-body-md text-body-sm font-medium text-on-surface"
          >
            Candidate plan (structured JSON — agent-proposed, untrusted until validated)
          </label>
          <button
            type="button"
            onClick={loadExample}
            className="font-body-sm text-[12px] text-primary-container underline decoration-outline/40 underline-offset-2 hover:underline"
          >
            Load the GitHub #991 example
          </button>
        </div>
        <textarea
          id="candidate-plan-json"
          rows={18}
          value={planText}
          onChange={(e) => setPlanText(e.target.value)}
          spellCheck={false}
          className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-2.5 font-mono-code text-[12px] text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
        />
      </div>

      <div className="flex flex-wrap gap-space-sm">
        <button
          type="button"
          onClick={handleValidate}
          disabled={pending}
          aria-busy={pending}
          className="flex h-11 items-center gap-2 rounded-lg border border-outline-variant/40 px-space-lg font-headline-sm text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? "Validating…" : "Validate"}
        </button>
        <button
          type="button"
          onClick={handlePropose}
          disabled={pending || !hasAccepted}
          aria-busy={pending}
          title={!hasAccepted ? "Validate first — at least one node must be accepted" : undefined}
          className="flex h-11 items-center gap-2 rounded-lg bg-primary px-space-lg font-headline-sm text-body-md font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? "Proposing…" : "Propose contract"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="font-body-sm text-body-sm text-deny">
          {error}
        </p>
      ) : null}

      {validation ? (
        <section
          id="plan-findings"
          aria-labelledby="plan-findings-heading"
          className="rounded-xl border border-outline-variant/30 bg-surface-container"
        >
          <header className="border-b border-outline-variant/25 px-space-lg py-space-md">
            <h2
              id="plan-findings-heading"
              className="font-headline-sm text-headline-sm font-semibold text-on-surface"
            >
              Findings per plan node
            </h2>
            <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
              {validation.acceptedNodeIds.length} of {validation.findings.length} nodes accepted — only
              accepted operations reach the minimum-authority solver.
            </p>
          </header>
          <ul className="divide-y divide-outline-variant/20">
            {validation.findings.map((finding) => (
              <li key={finding.nodeId} className="flex flex-col gap-1 px-space-lg py-space-sm">
                <div className="flex items-center gap-space-sm">
                  <span className="font-mono-code text-[12px] text-on-surface">{finding.nodeId}</span>
                  <span
                    className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_STYLE[finding.status] ?? "border-outline-variant/40 text-on-surface-variant"}`}
                  >
                    {finding.status.replace(/_/g, " ")}
                  </span>
                </div>
                {finding.reasons.length > 0 ? (
                  <p className="font-body-sm text-[12px] text-on-surface-variant">
                    {finding.reasons.join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {proposal ? (
        <section
          id="contract-proposal"
          aria-labelledby="contract-proposal-heading"
          className="rounded-xl border border-primary/30 bg-primary/5"
        >
          <header className="border-b border-primary/20 px-space-lg py-space-md">
            <h2
              id="contract-proposal-heading"
              className="font-headline-sm text-headline-sm font-semibold text-on-surface"
            >
              Contract proposed — not active
            </h2>
            <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
              Version {proposal.version}. This grants no runtime authority until a later activation step that
              doesn&apos;t exist in this build.
            </p>
          </header>
          <div className="grid grid-cols-1 gap-space-md p-space-lg sm:grid-cols-2">
            <div>
              <h3 className="mb-space-sm font-label-caps text-label-caps uppercase tracking-widest text-on-surface-variant">
                Minimum permissions selected
              </h3>
              <ul className="space-y-1">
                {proposal.selectedPermissionIds.map((id) => (
                  <li key={id} className="font-mono-code text-[12px] text-allow">
                    {id}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-space-sm font-label-caps text-label-caps uppercase tracking-widest text-on-surface-variant">
                Excess operations exposed by those permissions
              </h3>
              {proposal.excessOperations.length === 0 ? (
                <p className="font-body-sm text-[12px] text-on-surface-variant">None — an exact fit.</p>
              ) : (
                <ul className="space-y-1">
                  {proposal.excessOperations.map((op) => (
                    <li key={op} className="font-mono-code text-[12px] text-amber-300">
                      {op}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="border-t border-primary/20 px-space-lg py-space-md">
            <button
              type="button"
              onClick={() => router.push(`/app/tasks/${taskId}`)}
              className="font-body-sm text-body-sm text-primary-container underline decoration-outline/40 underline-offset-2 hover:underline"
            >
              View the task and its proposed contract
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
