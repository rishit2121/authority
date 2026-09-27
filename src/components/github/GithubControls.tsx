"use client";

import { useState, useTransition } from "react";

import {
  bindTaskRepositoryAction,
  disconnectGithubAction,
  refreshGithubAction,
  resolveIndeterminateAction,
  setRepositoryAllowedAction,
  type GithubActionResult,
} from "@/app/app/integrations/github/actions";

const BTN =
  "rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1.5 font-body-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60";

function useAction() {
  const [result, setResult] = useState<GithubActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<GithubActionResult>) =>
    start(async () => {
      setResult(await fn());
    });
  return { result, pending, run };
}

function Result({ result }: { result: GithubActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`font-body-sm text-body-sm ${result.ok ? "text-allow" : "text-deny"}`}
    >
      {result.ok ? (result.message ?? "Done.") : result.error}
    </p>
  );
}

export function InstallationActions({
  installationRowId,
  githubInstallationId,
  canAdmin,
}: {
  installationRowId: string;
  githubInstallationId: string;
  canAdmin: boolean;
}) {
  const { result, pending, run } = useAction();
  const [uninstall, setUninstall] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!canAdmin)
    return (
      <p className="font-body-sm text-body-sm text-outline">
        Managing the installation requires the admin role.
      </p>
    );
  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center gap-space-sm">
        <button
          type="button"
          className={BTN}
          disabled={pending}
          data-testid="github-refresh"
          onClick={() => run(() => refreshGithubAction(installationRowId, githubInstallationId))}
        >
          Re-verify with GitHub
        </button>
        {confirming ? (
          <>
            <label className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant">
              <input type="checkbox" checked={uninstall} onChange={(e) => setUninstall(e.target.checked)} />{" "}
              Also uninstall the App from GitHub
            </label>
            <button
              type="button"
              className={`${BTN} !border-deny/50 !text-deny`}
              disabled={pending}
              data-testid="github-disconnect-confirm"
              onClick={() => run(() => disconnectGithubAction(installationRowId, uninstall))}
            >
              Confirm disconnect
            </button>
            <button type="button" className={BTN} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`${BTN} !text-deny`}
            data-testid="github-disconnect"
            onClick={() => setConfirming(true)}
          >
            Disconnect
          </button>
        )}
      </div>
      <Result result={result} />
    </div>
  );
}

export function RepositoryToggle({
  repositoryId,
  allowed,
  disabled,
  name,
}: {
  repositoryId: string;
  allowed: boolean;
  disabled: boolean;
  name: string;
}) {
  const { result, pending, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={BTN}
        disabled={disabled || pending}
        aria-label={`${allowed ? "Remove" : "Allow"} ${name}`}
        data-testid={`repo-toggle-${name}`}
        onClick={() => run(() => setRepositoryAllowedAction(repositoryId, !allowed))}
      >
        {allowed ? "Remove from allowlist" : "Allow"}
      </button>
      <Result result={result} />
    </div>
  );
}

export function BindRepositoryForm({
  taskId,
  repositories,
}: {
  taskId: string;
  repositories: Array<{ id: string; fullName: string }>;
}) {
  const { result, pending, run } = useAction();
  const [repo, setRepo] = useState(repositories[0]?.id ?? "");
  if (repositories.length === 0) {
    return (
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        No repositories are on the allowlist yet. An admin can allow one under Integrations → GitHub.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center gap-space-sm">
        <label htmlFor="bind-repo" className="font-body-sm text-body-sm text-on-surface">
          Repository
        </label>
        <select
          id="bind-repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-1.5 font-mono-code text-[12px] text-on-surface"
          data-testid="bind-repo-select"
        >
          {repositories.map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={BTN}
          disabled={pending}
          data-testid="bind-repo-submit"
          onClick={() => run(() => bindTaskRepositoryAction(taskId, repo))}
        >
          Bind to this task
        </button>
      </div>
      <p className="font-body-sm text-body-sm text-outline">
        A binding is permanent for the task; execution is only ever possible against this repository.
      </p>
      <Result result={result} />
    </div>
  );
}

export function ResolveIndeterminateForm({ taskId, executionId }: { taskId: string; executionId: string }) {
  const { result, pending, run } = useAction();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`note-${executionId}`} className="font-body-sm text-body-sm text-on-surface">
        What did you find on GitHub?
      </label>
      <input
        id={`note-${executionId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        className="rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-1.5 font-body-sm text-body-sm text-on-surface"
      />
      <div className="flex gap-space-sm">
        <button
          type="button"
          className={BTN}
          disabled={pending}
          data-testid={`resolve-executed-${executionId}`}
          onClick={() => run(() => resolveIndeterminateAction(taskId, executionId, "executed", note))}
        >
          It was executed
        </button>
        <button
          type="button"
          className={BTN}
          disabled={pending}
          onClick={() => run(() => resolveIndeterminateAction(taskId, executionId, "not_executed", note))}
        >
          It was not executed
        </button>
      </div>
      <Result result={result} />
    </div>
  );
}
