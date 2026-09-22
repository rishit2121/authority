import { Icon } from "@/components/ui/Icon";

import { Panel } from "./panels";

/**
 * The task boundary stated plainly: what the agent may do, and the things it
 * is structurally prevented from doing.
 */
const ALLOWED = [
  { label: "Read issue #991", note: "issue_number = 991" },
  { label: "Read payments-api", note: "repository = payments-api" },
  { label: "Create branch fix-991", note: "branch matches fix-*" },
  { label: "Push only to fix-991", note: "branch matches fix-*" },
  { label: "Open one pull request targeting main", note: "base = main · max 1 invocation" },
];

const DENIED = [
  { label: "Read repository secrets", note: "github.get_repository_secret — hard denial" },
  { label: "Push directly to main", note: "blocked by the fix-* branch constraint" },
  { label: "Modify GitHub Actions workflows", note: "github.update_workflow — hard denial" },
  { label: "Merge the pull request", note: "github.merge_pull_request — hard denial" },
  { label: "Create a release or deploy", note: "github.create_release — hard denial" },
];

export function BoundarySummary() {
  return (
    <Panel id="boundary" title="Task boundary" subtitle="Authority for this task, not access to the account">
      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-2">
        <div>
          <h3 className="mb-space-sm flex items-center gap-2 font-label-caps text-label-caps uppercase tracking-widest text-allow">
            <Icon name="check_circle" size={14} /> Allowed or constrained
          </h3>
          <ul className="space-y-space-sm">
            {ALLOWED.map((item) => (
              <li
                key={item.label}
                className="rounded border border-allow/25 bg-allow/5 px-space-md py-space-sm"
              >
                <span className="font-body-md text-body-md text-on-surface">{item.label}</span>
                <span className="mt-0.5 block font-mono-code text-[11px] text-allow">{item.note}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-space-sm flex items-center gap-2 font-label-caps text-label-caps uppercase tracking-widest text-deny">
            <Icon name="block" size={14} /> Denied
          </h3>
          <ul className="space-y-space-sm">
            {DENIED.map((item) => (
              <li
                key={item.label}
                className="rounded border border-deny/25 bg-deny/5 px-space-md py-space-sm"
              >
                <span className="font-body-md text-body-md text-on-surface">{item.label}</span>
                <span className="mt-0.5 block font-mono-code text-[11px] text-deny">{item.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
