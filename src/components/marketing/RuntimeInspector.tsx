import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";

const TOOL_CALLS = [
  { verdict: "ALLOW" as const, call: 'github.get_pull_request("payments-api", 991)', meta: "0.4ms" },
  { verdict: "ALLOW" as const, call: 'github.create_branch("payments-api", "fix-991")', meta: "0.9ms" },
  {
    verdict: "DENY" as const,
    call: 'aws_secrets.get("db_master_password")',
    meta: "BLOCKED (Intent Out-of-Scope)",
  },
];

const TIMELINE = [
  { label: "1. Task Ingest ✓", tone: "text-allow" },
  { label: "2. Plan Proposed ✓", tone: "text-allow" },
  { label: "3. Intent Match ✓", tone: "text-allow" },
  { label: "4. Intercept Denied (Secrets) ✕", tone: "text-error" },
  { label: "5. Branch Push ✓", tone: "text-allow" },
  { label: "6. Tokens Revoked ✓", tone: "text-primary" },
];

export function RuntimeInspector() {
  return (
    <section className="mx-auto w-full max-w-[1280px] px-margin py-space-2xl md:px-margin-lg md:py-[120px]">
      <div className="mb-space-xl flex flex-col justify-between gap-space-lg md:flex-row md:items-end">
        <div>
          <span className="font-label-caps text-label-caps uppercase tracking-widest text-primary">
            Real-time Telemetry
          </span>
          <h2 className="mt-space-xs font-headline-lg text-[2rem] font-semibold leading-[1.18] tracking-tight text-on-surface md:text-[2.5rem]">
            Deterministic Runtime Inspector
          </h2>
        </div>
        <div className="flex items-center gap-space-sm">
          <StatusDot className="bg-allow" size={10} />
          <span className="font-mono-token text-mono-token uppercase text-on-surface-variant">
            GATEWAY: ACTIVE // LATENCY &lt; 2MS
          </span>
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl">
        {/* Browser shell */}
        <div className="flex h-12 items-center justify-between border-b border-outline-variant/30 bg-surface-container-low px-space-md">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#FF5F56]/80" />
            <span className="h-3 w-3 rounded-full bg-[#FFBD2E]/80" />
            <span className="h-3 w-3 rounded-full bg-[#27C93F]/80" />
            <span className="ml-4 hidden items-center gap-2 rounded border border-outline-variant/30 bg-surface-container px-3 py-1 font-mono-code text-[11px] text-outline sm:flex">
              <Icon name="lock" size={13} className="text-primary" />
              authority://app.cluster-01.internal/tasks/1842/telemetry
            </span>
          </div>
          <div className="flex items-center gap-space-sm">
            <span className="rounded border border-allow/30 bg-allow/10 px-2 py-0.5 font-mono-token text-[10px] text-allow">
              [• ENFORCING]
            </span>
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-error/40 bg-error/15 px-3 py-1 font-mono-token text-[10px] uppercase tracking-wider text-error transition-colors hover:bg-error/25"
            >
              <Icon name="cancel" size={14} /> Kill Switch
            </button>
          </div>
        </div>

        <div className="grid min-h-[460px] grid-cols-1 lg:grid-cols-12">
          {/* Live topology */}
          <div className="relative flex flex-col justify-between border-b border-outline-variant/30 bg-code-surface p-space-lg lg:col-span-7 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-space-sm font-mono-code text-[11px] text-outline">
              <span>LIVE SESSION: TASK #1842</span>
              <span className="text-primary">AGENT_ID: coding-agent-17</span>
            </div>

            <div className="flex flex-col gap-space-md py-space-xl">
              <div className="flex flex-wrap items-center gap-space-md">
                <span className="flex items-center gap-2 rounded-lg border border-primary/40 bg-surface-container p-2.5 font-mono-code text-[12px] text-primary">
                  <Icon name="smart_toy" size={16} /> coding-agent-17
                </span>
                <span className="font-mono-code text-[11px] text-outline">──[delegates]──►</span>
                <span className="rounded border border-outline-variant/40 bg-surface-container-high px-2.5 py-1 font-mono-code text-[11px] text-on-surface">
                  Contract #1842 Validated
                </span>
              </div>

              <div className="ml-5 flex flex-col gap-2 border-l-2 border-primary/20 py-2 pl-space-2xl">
                {TOOL_CALLS.map((entry) => {
                  const denied = entry.verdict === "DENY";
                  return (
                    <div key={entry.call} className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 font-mono-code text-[11px] ${
                          denied
                            ? "border border-error/30 bg-error/10 text-error"
                            : "border border-allow/30 bg-allow/10 text-allow"
                        }`}
                      >
                        {entry.verdict}
                      </span>
                      <span
                        className={`font-mono-code text-[12px] ${
                          denied ? "text-on-surface-variant line-through" : "text-on-surface"
                        }`}
                      >
                        {entry.call}
                      </span>
                      <span
                        className={`ml-auto font-mono-code text-[10px] ${denied ? "text-error" : "text-outline"}`}
                      >
                        {entry.meta}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-space-md">
                <span className="flex items-center gap-2 rounded border border-secondary/40 bg-surface-container p-2 font-mono-code text-[11px] text-secondary">
                  <Icon name="token" size={15} /> Ephemeral Token: 0x8F9a… [REVOKED ON COMPLETE]
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-surface-container p-space-sm font-mono-code text-[11px] text-outline">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-allow" /> Cryptographic signature: Ed25519
                validated
              </span>
              <span className="text-on-surface">Epoch: 1714829391</span>
            </div>
          </div>

          {/* Contract detail */}
          <div className="flex flex-col justify-between bg-surface-container-low p-space-lg lg:col-span-5">
            <div>
              <div className="mb-space-md flex items-center justify-between border-b border-outline-variant/20 pb-space-sm">
                <span className="font-mono-token text-[11px] uppercase text-primary">
                  Active Capability Contract
                </span>
                <span className="font-mono-code text-[11px] text-outline">TTL: 08m 14s</span>
              </div>

              <div className="space-y-space-md font-mono-code text-[11px]">
                <div>
                  <span className="block text-[10px] uppercase text-outline">
                    Granted Target Repositories:
                  </span>
                  <div className="mt-1 rounded border border-outline-variant/20 bg-surface-container p-2 text-on-surface">
                    org/payments-api <span className="text-[10px] text-allow">(branch: fix-991 only)</span>
                  </div>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-outline">Permitted Mutations:</span>
                  <div className="mt-1 space-y-1 rounded border border-outline-variant/20 bg-surface-container p-2 text-on-surface">
                    <div>+ github.create_pull_request</div>
                    <div>+ git.push_commit</div>
                  </div>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-error">Explicit Blacklist:</span>
                  <div className="mt-1 space-y-1 rounded border border-error/20 bg-surface-container p-2 text-error">
                    <div>✕ *secrets*</div>
                    <div>✕ database.production.write</div>
                    <div>✕ env.ALL</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-space-sm border-t border-outline-variant/20 pt-space-md">
              <button
                type="button"
                className="flex-1 rounded border border-outline-variant/30 bg-surface-container-high py-2 font-body-sm text-[12px] text-on-surface transition-colors hover:bg-surface-bright"
              >
                Export Evidence Package
              </button>
              <button
                type="button"
                className="flex-1 rounded bg-primary py-2 font-body-sm text-[12px] font-medium text-on-primary transition-colors hover:bg-primary-fixed"
              >
                Update Contract
              </button>
            </div>
          </div>
        </div>

        {/* Execution timeline */}
        <div className="flex items-center justify-between overflow-x-auto border-t border-outline-variant/30 bg-timeline-surface px-space-md py-space-sm font-mono-code text-[11px]">
          <div className="flex shrink-0 items-center gap-4 text-outline">
            {TIMELINE.map((entry, index) => (
              <span key={entry.label} className="flex items-center gap-4">
                <span className={`font-semibold ${entry.tone}`}>{entry.label}</span>
                {index < TIMELINE.length - 1 ? <span>→</span> : null}
              </span>
            ))}
          </div>
          <span className="ml-4 shrink-0 text-on-surface-variant">Duration: 42.1s</span>
        </div>
      </div>
    </section>
  );
}
