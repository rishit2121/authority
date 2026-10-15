"use client";

import { useState, useTransition } from "react";

import { archiveApprovalRuleAction, createApprovalRuleAction } from "@/app/app/actions";

export interface ApprovalRuleView {
  id: string;
  name: string;
  key: string;
  matches: string;
  role: string;
}

const ACTION_OPTIONS: [string, string][] = [
  ["money", "Money movement (refunds, charges)"],
  ["external", "Messages to people outside the organization"],
  ["delete", "Deletes and admin actions"],
  ["sensitive", "Confidential or secret data"],
  ["write", "Any write at all"],
];

const ROLE_LABEL: Record<string, string> = {
  security_admin: "a security admin or above",
  admin: "an admin or the owner",
  owner: "the owner",
};

const fieldClass =
  "rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal disabled:opacity-60";

function describe(rule: ApprovalRuleView): string {
  if (rule.key === "action") return ACTION_OPTIONS.find(([v]) => v === rule.matches)?.[1] ?? rule.matches;
  if (rule.key === "provider") return `Anything on ${rule.matches}`;
  if (rule.key === "tool") return rule.matches;
  return `${rule.key} = ${rule.matches}`;
}

/**
 * The organization's approval rules. With none, no task ever waits for a
 * person; each rule adds exactly one condition under which it does.
 */
export function ApprovalRulesPanel({
  rules,
  tools,
  canEdit,
}: {
  rules: ApprovalRuleView[];
  tools: string[];
  canEdit: boolean;
}) {
  const providers = [...new Set(tools.map((t) => t.split(".")[0]))].sort();
  const [key, setKey] = useState("action");
  const [matches, setMatches] = useState("money");
  const [role, setRole] = useState("admin");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const choose = (nextKey: string) => {
    setKey(nextKey);
    setMatches(
      nextKey === "action" ? "money" : nextKey === "provider" ? (providers[0] ?? "") : (tools[0] ?? ""),
    );
  };

  const add = () =>
    start(async () => {
      setError(null);
      const result = await createApprovalRuleAction({ key, matches, role });
      if (!result.ok) setError(result.error ?? "Could not add the rule.");
    });

  const remove = (id: string) =>
    start(async () => {
      setError(null);
      const result = await archiveApprovalRuleAction(id);
      if (!result.ok) setError(result.error ?? "Could not remove the rule.");
    });

  return (
    <section
      aria-labelledby="approval-rules-heading"
      className="rounded-[12px] border border-line bg-paper-raised p-5"
      data-testid="approval-rules"
    >
      <h2 id="approval-rules-heading" className="text-[15px] font-semibold text-ink">
        Approval rules
      </h2>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
        Tasks start as soon as their contract is ready unless they match a rule below — then they wait for a
        person here. Either way, every call is still checked against the task&apos;s contract.
      </p>

      <ul className="mt-4 flex flex-col gap-2" data-testid="approval-rules-list">
        {rules.length === 0 ? (
          <li className="rounded-lg border border-dashed border-line px-4 py-3 text-[13px] text-ink-soft">
            No rules — no task needs approval.
          </li>
        ) : (
          rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-3"
            >
              <span className="text-[14px] text-ink">
                <span className="font-medium">{describe(rule)}</span>
                <span className="text-ink-soft"> — approved by {ROLE_LABEL[rule.role] ?? rule.role}</span>
              </span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(rule.id)}
                  className="text-[13px] text-ink-soft underline-offset-2 hover:text-deny hover:underline disabled:opacity-60"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>

      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
            Require approval for
            <select
              value={key}
              onChange={(e) => choose(e.target.value)}
              className={fieldClass}
              data-testid="rule-key"
            >
              <option value="action">A kind of action</option>
              <option value="provider">A service</option>
              <option value="tool">A specific tool</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
            Which
            <select
              value={matches}
              onChange={(e) => setMatches(e.target.value)}
              className={fieldClass}
              data-testid="rule-matches"
            >
              {(key === "action"
                ? ACTION_OPTIONS
                : (key === "provider" ? providers : tools).map((v) => [v, v])
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
            Approved by
            <select value={role} onChange={(e) => setRole(e.target.value)} className={fieldClass}>
              <option value="admin">An admin or the owner</option>
              <option value="security_admin">A security admin or above</option>
              <option value="owner">The owner</option>
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !matches}
            onClick={add}
            data-testid="rule-add"
            className="h-[38px] rounded-lg bg-primary px-4 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pending ? "Saving…" : "Add rule"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-ink-soft">Only admins can change approval rules.</p>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-deny">
          {error}
        </p>
      ) : null}
    </section>
  );
}
