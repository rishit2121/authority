"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createAutomationPolicyAction,
  revokeAutomationPolicyAction,
} from "@/app/app/settings/applications/actions";
import { StatusPill } from "@/components/ui/StatusPill";

export interface AutomationPolicyRow {
  id: string;
  tool: string;
  createdAt: string;
}

export function AutomationPoliciesPanel({
  applicationId,
  policies,
}: {
  applicationId: string;
  policies: AutomationPolicyRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState("");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createAutomationPolicyAction(applicationId, tool.trim());
      if (result.ok) {
        setTool("");
        router.refresh();
      } else {
        setError(result.error ?? "Could not add the automation policy.");
      }
    });
  }

  function handleRevoke(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeAutomationPolicyAction(applicationId, id);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not revoke the automation policy.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-paper-raised p-5">
      <h2 className="text-[15px] font-semibold text-ink">Automatic activation</h2>
      <p className="text-[13px] text-ink-soft">
        Tools listed here let this application&apos;s backend credential activate a proposed contract itself,
        without a dashboard click — but only when that contract&apos;s own freshly recompiled approval
        requirement is independently empty. A tool that genuinely needs approval is never auto-activated
        merely because it is listed here.
      </p>

      {error ? (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
            Tool (e.g. gmail.list_labels)
          </span>
          <input
            type="text"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            placeholder="connector.operation"
            className="w-64 rounded-lg border border-line-strong bg-paper px-2.5 py-1.5 font-mono-code text-[12px] text-ink"
          />
        </label>
        <button
          type="button"
          disabled={pending || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(tool.trim())}
          onClick={handleCreate}
          className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:opacity-50"
        >
          Allow
        </button>
      </div>

      {policies.length === 0 ? (
        <p className="text-[13px] text-ink-soft">No tools are auto-activated yet for this application.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {policies.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper p-3.5"
            >
              <span className="font-mono-code text-[12px] text-ink">{p.tool}</span>
              <div className="flex items-center gap-2">
                <StatusPill tone="positive">Allowed</StatusPill>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleRevoke(p.id)}
                  className="text-[12px] font-medium text-deny underline disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
