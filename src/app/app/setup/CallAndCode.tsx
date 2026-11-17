"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CodeBlock } from "@/components/docs/CodeBlock";
import type { FirstCallResult } from "@/lib/setup/first-call";
import {
  envBlock,
  firstCallSample,
  QUICKSTART_DOCS_PATH,
  SAMPLE_FILE,
  SAMPLE_RUN_COMMAND,
  setupPrompt,
} from "@/lib/setup/handoff";
import { installCommand, type SetupEnv } from "@/lib/setup/quick-setup";
import { liveOutcomeLabel, type CallTone, type ReadCall } from "@/lib/setup/state";

import { issueSetupKeysAction, makeProtectedCallAction } from "./actions";
import { setupHref } from "@/lib/setup/return-to";
import { BTN_PRIMARY, BTN_SECONDARY, Pill, Step } from "./Step";

export interface RecordedCall {
  taskId: string;
  createdAt: string;
  label: { text: string; tone: CallTone };
  reasonCodes: string[];
  receiptId: string | null;
}

function newAttemptId(): string {
  return crypto.randomUUID();
}

/**
 * Steps 2 and 3 of the Setup page. One client component because the keys minted by the call (shown ONCE) feed the
 * `.env` block in step 3 and live only in this component's memory -- never in the URL, storage or the server page.
 */
export function CallAndCode({
  applicationId,
  connectionId,
  connectorId,
  call,
  canAdmin,
  ready,
  baseUrl,
  initCommand,
  recorded,
  today,
}: {
  applicationId: string;
  connectionId: string;
  connectorId: string;
  call: ReadCall | null;
  canAdmin: boolean;
  /** The setup customer can use the connection (otherwise the call would end in needs_access). */
  ready: boolean;
  baseUrl: string;
  initCommand: string;
  recorded: RecordedCall | null;
  /** YYYY-MM-DD from the server, so the label never differs between server and browser render. */
  today: string;
}) {
  const router = useRouter();
  const [attemptId, setAttemptId] = useState(newAttemptId);
  const [live, setLive] = useState<FirstCallResult | null>(null);
  const [env, setEnv] = useState<SetupEnv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [issuing, startIssue] = useTransition();

  const makeCall = () => {
    setError(null);
    start(async () => {
      const result = await makeProtectedCallAction({ applicationId, connectionId, attemptId });
      if (!result.ok || !result.data) {
        // Not a definitive answer: keep the same attemptId, so clicking again can never run the call twice.
        setError(result.error ?? "The call could not be made.");
        return;
      }
      const { result: outcome, env: minted, alreadyRan } = result.data;
      setLive(alreadyRan ? null : outcome);
      if (minted) setEnv(minted);
      setAttemptId(newAttemptId());
      if (outcome.taskId)
        router.push(setupHref({ app: applicationId, connection: connectionId, task: outcome.taskId }));
      else router.refresh();
    });
  };

  const issueKeys = () => {
    setError(null);
    startIssue(async () => {
      const result = await issueSetupKeysAction({ applicationId });
      if (result.ok && result.data) setEnv(result.data);
      else setError(result.error ?? "Could not issue new keys.");
    });
  };

  const liveLabel = live ? liveOutcomeLabel(live.outcome, live.preparedStatus) : null;
  const showLive = live && (!recorded || live.taskId === recorded.taskId || !live.taskId);
  const callDone = Boolean(recorded && recorded.label.tone === "positive");
  const context = { baseUrl, call, connectorId, connectionId, env };

  return (
    <>
      <Step number={2} title="Make a protected call" done={callDone} active={!callDone}>
        {!call ? (
          <p className="text-[14px] text-ink-soft" data-testid="setup-no-sample-read">
            No sample read for this connector. Go to step 3.
          </p>
        ) : (
          <>
            <p className="text-[14px] text-ink-soft">
              Runs <code>{call.tool}</code> once, for real, through this deployment&apos;s own API: a task for
              your test customer with only this connection, a fixed one-step read plan (no model), a
              two-minute task session, then authorize and execute. Nothing is retried.
            </p>
            {canAdmin ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={pending || !ready}
                  onClick={makeCall}
                  className={BTN_PRIMARY}
                  data-testid="setup-make-call"
                >
                  {pending ? "Calling…" : recorded ? "Make another protected call" : "Make a protected call"}
                </button>
                {!ready ? (
                  <span className="text-[13px] text-ink-soft">
                    Give your test customer access first (step 1).
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] text-ink-soft">
                Making the call issues keys, so only an owner or admin can run it.
              </p>
            )}
          </>
        )}

        {error ? (
          <p role="alert" className="text-[13px] text-deny">
            {error}
          </p>
        ) : null}

        {showLive && live && liveLabel ? (
          <div
            className="flex flex-col gap-2 rounded-lg border border-line p-4"
            data-testid="setup-call-result"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={liveLabel.tone} testId="setup-call-label">
                {liveLabel.text}
              </Pill>
              {live.summaryOfData ? <span className="text-[13px] text-ink">{live.summaryOfData}</span> : null}
            </div>
            <p className="text-[13px] text-ink-soft">{live.detail}</p>
            {live.decision ? (
              <p className="text-[13px] text-ink-soft">
                Decision <code>{live.decision.status}</code>
                {live.decision.reasonCodes.length ? (
                  <>
                    {" "}
                    · reasons <code>{live.decision.reasonCodes.join(", ")}</code>
                  </>
                ) : null}
                {live.decision.summary ? <> · {live.decision.summary}</> : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {recorded ? (
          <div
            className="flex flex-col gap-1.5 rounded-lg border border-line p-4"
            data-testid="setup-recorded-call"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-ink-soft">Recorded for this task:</span>
              <Pill tone={recorded.label.tone} testId="setup-recorded-label">
                {recorded.label.text}
              </Pill>
            </div>
            <p className="text-[13px] text-ink-soft">
              Reasons:{" "}
              <code data-testid="setup-recorded-reasons">
                {recorded.reasonCodes.length ? recorded.reasonCodes.join(", ") : "none"}
              </code>
            </p>
            <p className="text-[13px] text-ink-soft">
              Receipt: <code data-testid="setup-recorded-receipt">{recorded.receiptId ?? "none"}</code>
            </p>
            <Link
              href={`/app/tasks/${recorded.taskId}`}
              className="text-[13px] font-medium text-primary hover:underline"
            >
              Open the task
            </Link>
          </div>
        ) : null}
      </Step>

      <Step number={3} title="Use it in your code" done={false} active={callDone}>
        <div className="flex flex-col gap-2">
          <span className="text-[14px] text-ink">
            1. Your server&apos;s <code>.env</code>
          </span>
          {env ? (
            <p className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-[13px] text-ink">
              <strong>Copy this now.</strong> The two keys are shown only once. Keep them on your server,
              never in a browser or a repository.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
              <span>
                {recorded
                  ? `Keys were shown once (${recorded.createdAt.slice(0, 10)}).`
                  : "Keys are shown here once, when you make the protected call."}
              </span>
              {canAdmin ? (
                <button
                  type="button"
                  disabled={issuing}
                  onClick={issueKeys}
                  className={BTN_SECONDARY}
                  data-testid="setup-issue-keys"
                >
                  {issuing ? "Issuing…" : `Issue a new pair (${today})`}
                </button>
              ) : null}
            </div>
          )}
          <CodeBlock code={envBlock(context)} copyAlwaysVisible={Boolean(env)} data-testid="setup-env" />
        </div>

        {call ? (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-[14px] text-ink">2. Install the SDK and run one call (Node 20+)</span>
              <CodeBlock code={installCommand(baseUrl)} data-testid="setup-install" />
              <span className="text-[13px] text-ink-soft">
                Save as <code>{SAMPLE_FILE}</code> next to your <code>.env</code>:
              </span>
              <CodeBlock
                code={firstCallSample({ ...context, call })}
                language="javascript"
                data-testid="setup-sample-code"
              />
              <CodeBlock code={SAMPLE_RUN_COMMAND} data-testid="setup-run" />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[14px] text-ink">3. Or hand it to a coding agent</span>
              <CopyPromptButton prompt={setupPrompt({ ...context, call })} />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-ink-soft">
            Read the <Link href={QUICKSTART_DOCS_PATH}>quickstart</Link> for the tools this connector offers.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-soft">
            Prefer a starter project? From a clone of the repo:
          </span>
          <CodeBlock code={initCommand} data-testid="setup-init" />
        </div>
      </Step>
    </>
  );
}

function CopyPromptButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <button
        type="button"
        className={BTN_SECONDARY}
        onClick={async () => {
          await navigator.clipboard.writeText(prompt);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        data-testid="setup-copy-prompt"
      >
        {copied ? "Copied" : "Copy setup prompt"}
      </button>
      <span className="ml-3 text-[12px] text-ink-soft">
        For Claude or Codex. Names the variables, never their values.
      </span>
    </div>
  );
}
