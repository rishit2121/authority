import type { TaskAuthorityContract } from "@/lib/domain";

import { Field, Panel } from "./panels";

function describeConstraint(key: string, equals?: string, matches?: string): string {
  return equals !== undefined ? `${key} = ${equals}` : `${key} matches ${matches}`;
}

const STATUS_LABEL: Record<TaskAuthorityContract["status"], string> = {
  draft: "Draft",
  proposed: "Proposed — not active",
  awaiting_approval: "Awaiting approval — not active",
  rejected: "Rejected — not active",
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  superseded: "Superseded",
};

/**
 * The Task Authority Contract: the ceiling on what this task may ever do.
 * Allowed actions and hard denials are shown side by side, because the pairing
 * is the product's whole argument.
 *
 * The status badge is load-bearing, not decorative: a `proposed` contract
 * grants zero runtime authority (see contract-verifier.ts's module doc),
 * and this panel must never render in a way that could be mistaken for an
 * active grant when it isn't one.
 */
export function ContractPanel({ contract }: { contract: TaskAuthorityContract }) {
  const isActive = contract.status === "active";

  return (
    <Panel
      id="contract"
      title="Task Authority Contract"
      subtitle={`${contract.id} · spec ${contract.specVersion} · v${contract.version} · derived from trusted user intent before the agent acted`}
      accent={isActive ? "cyan" : "neutral"}
    >
      <div className="mb-space-md flex items-center gap-space-sm">
        <span
          className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${
            isActive
              ? "border-allow/30 bg-allow/10 text-allow"
              : contract.status === "rejected"
                ? "border-deny/30 bg-deny/10 text-deny"
                : "border-outline-variant/40 bg-surface-container-high text-on-surface-variant"
          }`}
        >
          {STATUS_LABEL[contract.status]}
        </span>
        {!isActive ? (
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            This contract grants no runtime authority while it is not active.
          </span>
        ) : null}
      </div>

      {contract.status === "rejected" && contract.rejectionReason ? (
        <p className="mb-space-md rounded border border-deny/25 bg-deny/5 px-space-md py-space-sm font-body-sm text-body-sm text-deny">
          Rejected: {contract.rejectionReason}
        </p>
      ) : null}

      <dl className="mb-space-lg grid grid-cols-2 gap-space-md sm:grid-cols-4">
        <Field label="Max invocations">{contract.ephemeralLimits.maxToolInvocations}</Field>
        <Field label="Expires in">{contract.ephemeralLimits.expiresInSeconds}s</Field>
        <Field label="Allowed actions">{contract.allowedActions.length}</Field>
        <Field label="Hard denials">{contract.forbiddenResources.length}</Field>
      </dl>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-2">
        <div>
          <h3 className="mb-space-sm font-label-caps text-label-caps uppercase tracking-widest text-allow">
            Allowed actions
          </h3>
          <ul className="space-y-space-sm">
            {contract.allowedActions.map((action) => (
              <li
                key={action.tool}
                className="rounded border border-allow/25 bg-allow/5 px-space-md py-space-sm font-mono-code text-[12px]"
              >
                <span className="text-on-surface">{action.tool}</span>
                {action.constraints.length > 0 ? (
                  <span className="mt-1 block text-[11px] text-allow">
                    {action.constraints
                      .map((c) => describeConstraint(c.key, c.equals, c.matches))
                      .join(" · ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-space-sm font-label-caps text-label-caps uppercase tracking-widest text-deny">
            Forbidden resources
          </h3>
          <ul className="space-y-space-sm">
            {contract.forbiddenResources.map((resource) => (
              <li
                key={resource}
                className="rounded border border-deny/25 bg-deny/5 px-space-md py-space-sm font-mono-code text-[12px] text-deny"
              >
                {resource}
              </li>
            ))}
          </ul>
          <p className="mt-space-md font-body-sm text-body-sm text-on-surface-variant">
            Hard denials outrank every allow and every semantic signal. Nothing downstream can widen this
            contract.
          </p>
        </div>
      </div>
    </Panel>
  );
}
