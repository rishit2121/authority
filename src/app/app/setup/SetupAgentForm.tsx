"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { envFileText, type SetupEnv } from "@/lib/setup/quick-setup";

import { runQuickSetupAction } from "./actions";

export interface SetupConnectionOption {
  id: string;
  label: string;
}

const BTN_PRIMARY =
  "inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";

export function SetupAgentForm({
  connections,
  hasAgent,
}: {
  connections: SetupConnectionOption[];
  hasAgent: boolean;
}) {
  const [name, setName] = useState("My agent");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(connections.map((c) => c.id)));
  const [autoRunReads, setAutoRunReads] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState<SetupEnv | null>(null);
  const [showForm, setShowForm] = useState(!hasAgent);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (env) {
    return (
      <div className="flex flex-col gap-3" data-testid="setup-keys">
        <p className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-[13px] text-ink">
          <strong>Copy this now.</strong> The two keys are shown only once. Save them as a <code>.env</code>{" "}
          file next to your code, and never put them in a browser or a public repo.
        </p>
        <CodeBlock code={envFileText(env)} copyAlwaysVisible data-testid="setup-env" />
      </div>
    );
  }

  if (!showForm) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[14px] text-ink-soft">Your agent and keys are ready.</span>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="text-[13px] font-medium text-primary hover:underline"
          data-testid="setup-create-another"
        >
          Create another agent with new keys
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await runQuickSetupAction({
            agentName: name,
            connectionIds: [...selected],
            autoRunReads,
          });
          if (result.ok && result.data) {
            setEnv(result.data.env);
            router.refresh();
          } else setError(result.error ?? "Setup failed. Please try again.");
        });
      }}
    >
      <label className="flex max-w-sm flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">Agent name</span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-10 rounded-lg border border-line-strong bg-paper px-3 text-[14px] text-ink"
          data-testid="setup-agent-name"
        />
      </label>

      {connections.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Services this agent may use</legend>
          {connections.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[14px] text-ink">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setSelected(next);
                }}
                data-testid={`setup-connection-${c.id}`}
              />
              {c.label}
            </label>
          ))}
        </fieldset>
      ) : null}

      <label className="flex items-start gap-2 text-[14px] text-ink">
        <input
          type="checkbox"
          checked={autoRunReads}
          onChange={(e) => setAutoRunReads(e.target.checked)}
          className="mt-1"
          data-testid="setup-auto-run"
        />
        <span>
          Run read-only tools automatically
          <span className="block text-[13px] text-ink-soft">
            Anything that writes, sends, or spends money still waits for your approval.
          </span>
        </span>
      </label>

      {error ? (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      ) : null}

      <div>
        <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="setup-submit">
          {pending ? "Setting up…" : "Create agent and keys"}
        </button>
      </div>
    </form>
  );
}
