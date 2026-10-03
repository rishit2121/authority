"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  delegateGithubRepositoryToCustomerAction,
  revokeGithubRepositoryDelegationAction,
} from "@/app/app/settings/applications/actions";
import type { CustomerOption } from "@/components/application/ConnectionDelegationPanel";

export interface GithubRepositoryRow {
  repositoryId: string;
  fullName: string;
  delegations: Array<{ customerId: string; customerLabel: string }>;
}

/**
 * A GitHub repository is never an OAuth connection -- it comes from the
 * tenant's own installation allowlist (Integrations -> GitHub), not from
 * here. This panel only controls which of this application's customers an
 * already-allowed repository is available to through the developer API,
 * the GitHub-specific equivalent of ConnectionDelegationPanel above.
 */
export function GithubRepositoryDelegationPanel({
  applicationId,
  repositories,
  customerOptions,
}: {
  applicationId: string;
  repositories: GithubRepositoryRow[];
  customerOptions: CustomerOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});

  function grant(repositoryId: string) {
    const customerId = selected[repositoryId];
    if (!customerId) return;
    setError(null);
    startTransition(async () => {
      const result = await delegateGithubRepositoryToCustomerAction(applicationId, repositoryId, customerId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not delegate the repository.");
      }
    });
  }

  function revoke(repositoryId: string, customerId: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeGithubRepositoryDelegationAction(applicationId, repositoryId, customerId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not revoke the delegation.");
      }
    });
  }

  if (repositories.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-paper-raised p-5">
      <h2 className="text-[15px] font-semibold text-ink">GitHub repositories &amp; delegation</h2>
      <p className="text-[13px] text-ink-soft">
        Repositories come from the tenant&apos;s own GitHub installation allowlist (Integrations → GitHub) —
        delegating one here only grants one of this application&apos;s customers permission to bind it to
        their own tasks through the developer API, revocably, and never widens the allowlist itself.
      </p>
      {error ? (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {repositories.map((repo) => (
          <li
            key={repo.repositoryId}
            className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-3.5"
          >
            <span className="font-mono-code text-[12px] text-ink">{repo.fullName}</span>
            {repo.delegations.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {repo.delegations.map((d) => (
                  <li key={d.customerId} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-ink-soft">Delegated to {d.customerLabel}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => revoke(repo.repositoryId, d.customerId)}
                      className="font-medium text-deny underline disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {customerOptions.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  value={selected[repo.repositoryId] ?? ""}
                  onChange={(e) => setSelected((s) => ({ ...s, [repo.repositoryId]: e.target.value }))}
                  className="rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink"
                >
                  <option value="">Delegate to…</option>
                  {customerOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pending || !selected[repo.repositoryId]}
                  onClick={() => grant(repo.repositoryId)}
                  className="rounded-lg border border-line-strong px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:opacity-50"
                >
                  Grant
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
