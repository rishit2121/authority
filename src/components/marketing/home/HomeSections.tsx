import { CodeBlock } from "@/components/docs/CodeBlock";
import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { Icon } from "@/components/ui/Icon";
import {
  decisionLabel,
  dispatchStatus,
  outcomeFor,
  playbackFor,
  provenanceFor,
  reasonSentence,
} from "@/lib/proof-run/presentation";
import { capturedRun, engineeringUpdateRecipe, taskRunsFor } from "@/lib/proof-run/recipe";

function SectionTitle({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <>
      <p className="font-mono-code text-[12px] uppercase tracking-[0.1em] text-ink-soft">{eyebrow}</p>
      <h2
        id={id}
        className="mt-2 font-headline-lg text-[1.6rem] font-semibold leading-[1.2] tracking-[-0.02em] text-ink md:text-[1.9rem]"
      >
        {title}
      </h2>
    </>
  );
}

const STEPS = [
  {
    title: "Connect",
    body: "Connect the tools your agent uses: Slack, Gmail, GitHub, your database or your own API.",
  },
  {
    title: "Set limits",
    body: "For each task, name the tool, pin the destination and set how many calls it gets.",
  },
  {
    title: "Run",
    body: "Your agent calls through Authority; anything outside the task is refused before it runs.",
  },
];

export function SetupSteps() {
  return (
    <section aria-labelledby="steps-heading" className="py-10 md:py-14">
      <MarketingContainer>
        <SectionTitle id="steps-heading" eyebrow="How it fits in" title="Connect → Set limits → Run" />
        <ol className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-[12px] border border-line bg-paper-raised p-4">
              <p className="font-mono-code text-[12px] text-ink-soft">0{index + 1}</p>
              <p className="mt-1 text-[16px] font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-[14px] leading-[1.5] text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </MarketingContainer>
    </section>
  );
}

/** How each connector is actually set up in this codebase (src/app/app/integrations/*). No counts, no logo wall. */
const CONNECTORS: { name: string; setup: string }[] = [
  { name: "Gmail", setup: "Customer OAuth consent" },
  { name: "Slack", setup: "Workspace bot token" },
  { name: "GitHub", setup: "GitHub App installation, repository access" },
  { name: "Stripe", setup: "API key you configure" },
  { name: "Linear", setup: "API key you configure" },
  { name: "Notion", setup: "API key you configure" },
  { name: "PostgreSQL", setup: "Database credentials and published queries" },
  { name: "Custom HTTPS API", setup: "Your endpoint and credential" },
];

export function ConnectorList() {
  return (
    <section aria-labelledby="connectors-heading" className="py-10 md:py-14">
      <MarketingContainer>
        <SectionTitle id="connectors-heading" eyebrow="Connectors" title="What you can connect, and how" />
        <dl className="mt-6 grid grid-cols-1 border-t border-line sm:grid-cols-2">
          {CONNECTORS.map((connector) => (
            <div
              key={connector.name}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line py-3 sm:pr-8 sm:[&:nth-child(even)]:pl-8 sm:[&:nth-child(even)]:pr-0"
            >
              <dt className="text-[15px] font-medium text-ink">{connector.name}</dt>
              <dd className="text-[14px] text-ink-soft">{connector.setup}</dd>
            </div>
          ))}
        </dl>
      </MarketingContainer>
    </section>
  );
}

/** Matches the @authority/sdk facade (packages/sdk). Server-side only: it holds the backend and runtime keys. */
export const SDK_EXAMPLE = `import { Authority } from "@authority/sdk";

const authority = new Authority({
  baseUrl: process.env.AUTHORITY_URL!,
  backendKey: process.env.AUTHORITY_BACKEND_API_KEY!,
  agentId: process.env.AUTHORITY_AGENT_ID!,
  runtimeKey: process.env.AUTHORITY_AGENT_RUNTIME_KEY!,
});

const run = await authority.prepareTask({
  userId: user.id,
  request: "Post one engineering update",
  connections: { slack: process.env.SLACK_CONNECTION_ID! },
  actions: [
    {
      tool: "slack.post_message",
      arguments: { channel: "C0ENGINEERING" },
      agentGenerated: ["text"],
      maxInvocations: 1,
    },
  ],
});

if (run.status === "ready") {
  const result = await run.task.call(
    "slack.post_message",
    { text: "The deployment is complete." },
    { idempotencyKey: event.id },
  );
}`;

export function CodeExample() {
  return (
    <section aria-labelledby="code-heading" className="py-10 md:py-14">
      <MarketingContainer>
        <SectionTitle id="code-heading" eyebrow="In your code" title="The same task, from your backend" />
        <p className="mt-3 max-w-[40rem] text-[15px] leading-[1.6] text-ink-soft">
          Prepare the task with its limits, then make the call through it. The keys stay on your server.
        </p>
        <div className="mt-5 min-w-0">
          <p className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <Icon name="lock" size={14} className="text-ink-soft" />
            Server-side · TypeScript
          </p>
          <CodeBlock code={SDK_EXAMPLE} language="ts" copyAlwaysVisible data-testid="sdk-example" />
        </div>
      </MarketingContainer>
    </section>
  );
}

/** The first task of the run (a post, then a second post in the same task) as trace rows, from the transcript. */
export function RunDetail() {
  const all = playbackFor(engineeringUpdateRecipe, capturedRun);
  const firstRun = taskRunsFor(engineeringUpdateRecipe)[0] ?? [];
  const rows = firstRun.map((attempt) => all.find((item) => item.attempt.id === attempt.id)!);

  return (
    <section aria-labelledby="run-detail-heading" className="py-10 md:py-14">
      <MarketingContainer>
        <SectionTitle id="run-detail-heading" eyebrow="Run detail" title="What one task records" />
        <p className="mt-3 max-w-[40rem] text-[15px] leading-[1.6] text-ink-soft">
          One task from the example run: the post that went through, then a second post in the same task.{" "}
          <span className="text-ink">Source: {provenanceFor(capturedRun, true).source}.</span>
        </p>
        <ol className="mt-5 flex flex-col border-t border-line" data-testid="run-detail">
          {rows.map((item, index) => {
            const outcome = outcomeFor(item.transcript.result);
            const executed = outcome.tone === "executed";
            return (
              <li key={item.attempt.id} className="border-b border-line py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="font-mono-code text-[13px] text-ink-soft">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[15px] text-ink">{item.attempt.label}</span>
                    <code className="font-mono-code text-[12px] text-ink-soft">{item.attempt.tool}</code>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink">
                    <Icon
                      name={executed ? "check_circle" : "block"}
                      size={15}
                      className={executed ? "text-signal" : "text-denied"}
                    />
                    {outcome.label}
                  </span>
                </div>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-soft">
                  Decision: {decisionLabel(item.transcript.decision)} (
                  {item.transcript.reasonCodes.join(", ")}) · {dispatchStatus(item.transcript.dispatches)}
                  {item.transcript.receipt ? ` · Receipt ${item.transcript.receipt.receiptId}` : ""}
                </p>
                <p className="mt-0.5 text-[13.5px] leading-[1.55] text-ink-soft">
                  {reasonSentence(item.transcript)}
                </p>
              </li>
            );
          })}
        </ol>
      </MarketingContainer>
    </section>
  );
}
