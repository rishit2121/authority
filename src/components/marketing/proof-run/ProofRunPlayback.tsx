"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  decisionLabel,
  dispatchStatus,
  outcomeFor,
  playbackFor,
  provenanceFor,
  reasonSentence,
  scopeCardFor,
  type OutcomeTone,
  type PlaybackAttempt,
} from "@/lib/proof-run/presentation";
import {
  capturedRun,
  describeResult,
  engineeringUpdateRecipe,
  type ProofRunRecipe,
  type ProofRunTranscript,
} from "@/lib/proof-run/recipe";

import { ScopeCard } from "./ScopeCard";

/** Icon and text color per outcome. The label text always carries the meaning; color and icon only reinforce it. */
const TONE: Record<OutcomeTone, { icon: IconName; text: string; rule: string }> = {
  executed: { icon: "check_circle", text: "text-signal", rule: "border-l-signal" },
  blocked: { icon: "block", text: "text-denied", rule: "border-l-denied" },
  held: { icon: "visibility", text: "text-ink", rule: "border-l-warning" },
  unknown: { icon: "warning", text: "text-ink", rule: "border-l-warning" },
  failed: { icon: "error", text: "text-denied", rule: "border-l-denied" },
};

/**
 * The public Proof Run: a pure playback of a captured transcript against the checked-in recipe. It makes no network
 * request and has no inputs; every decision shown is the one recorded in the transcript, never computed here.
 */
export function ProofRunPlayback({
  recipeHashMatches,
  recipe = engineeringUpdateRecipe,
  transcript = capturedRun,
  layout = "split",
}: {
  /** Computed on the server: whether the transcript was captured from the recipe as it is now. */
  recipeHashMatches: boolean;
  recipe?: ProofRunRecipe;
  transcript?: ProofRunTranscript;
  /** "split": scope beside the attempts (home). "full": the same, with more room for the result (demo). */
  layout?: "split" | "full";
}) {
  const attempts = useMemo(() => playbackFor(recipe, transcript), [recipe, transcript]);
  const scope = useMemo(() => scopeCardFor(recipe), [recipe]);
  const provenance = provenanceFor(transcript, recipeHashMatches);
  const firstId = attempts[0]!.attempt.id;

  const [selectedId, setSelectedId] = useState(firstId);
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set([firstId]));
  // Animate only in response to a choice, never on first paint, and never under reduced motion.
  const [interacted, setInteracted] = useState(false);
  const reducedMotion = useReducedMotion();
  const animate = interacted && !reducedMotion;

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  const selectedIndex = Math.max(
    0,
    attempts.findIndex((a) => a.attempt.id === selectedId),
  );
  const selected = attempts[selectedIndex]!;

  function select(index: number, focus = false) {
    const target = attempts[index];
    if (!target) return;
    setInteracted(true);
    setSelectedId(target.attempt.id);
    setViewed((prev) => (prev.has(target.attempt.id) ? prev : new Set([...prev, target.attempt.id])));
    if (focus) tabRefs.current[index]?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = attempts.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  }

  function reset() {
    setInteracted(false);
    setSelectedId(firstId);
    setViewed(new Set([firstId]));
    tabRefs.current[0]?.focus();
  }

  return (
    <div className="min-w-0" data-testid="proof-run-playback">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-[999px] border border-line-strong bg-paper-raised px-3 py-1 text-[13px] font-medium text-ink">
          <Icon name="science" size={14} className="text-ink-soft" />
          {provenance.badge}
        </span>
        <span
          className="inline-flex items-center rounded-[999px] border border-line px-3 py-1 text-[13px] text-ink"
          data-testid="proof-run-source"
        >
          {provenance.source}
          {provenance.capturedOn ? (
            <span className="text-ink-soft">
              {" "}
              · <time dateTime={provenance.capturedOn}>{provenance.capturedOn}</time>
            </span>
          ) : null}
        </span>
      </div>
      {provenance.staleWarning ? (
        <p
          role="note"
          className="mt-3 flex items-start gap-2 rounded-[10px] border border-warning bg-paper-raised px-3 py-2 text-[14px] text-ink"
        >
          <Icon name="warning" size={16} className="mt-0.5 text-warning" />
          {provenance.staleWarning}
        </p>
      ) : null}

      <div
        className={`mt-5 grid grid-cols-1 gap-5 ${layout === "full" ? "lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"}`}
      >
        <ScopeCard scope={scope} showRequest testId="proof-run-scope" className="self-start" />

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p id={`${baseId}-label`} className="text-[14px] font-medium text-ink">
              What the agent tries
            </p>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-ink-soft" data-testid="proof-run-progress">
                Viewed {viewed.size} of {attempts.length}
              </span>
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-[7px] px-2 text-[13px] font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
              >
                <Icon name="replay" size={14} />
                Reset
              </button>
            </div>
          </div>

          <div
            role="tablist"
            aria-labelledby={`${baseId}-label`}
            className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2"
          >
            {attempts.map((item, index) => {
              const isSelected = index === selectedIndex;
              const wasViewed = viewed.has(item.attempt.id);
              return (
                <button
                  key={item.attempt.id}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(item.attempt.id)}
                  aria-selected={isSelected}
                  aria-controls={panelId}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => select(index)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  className={`flex min-h-[44px] items-center justify-between gap-2 rounded-[9px] border px-3 py-2 text-left text-[14px] transition-colors ${
                    isSelected
                      ? "border-ink bg-ink text-paper"
                      : "border-line-strong bg-paper-raised text-ink hover:border-ink"
                  }`}
                >
                  <span>
                    <span aria-hidden="true" className={isSelected ? "text-line-strong" : "text-ink-soft"}>
                      {index + 1}.{" "}
                    </span>
                    {item.attempt.label}
                  </span>
                  {wasViewed && !isSelected ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-ink-soft">
                      <Icon name="check_circle" size={12} />
                      <span className="sr-only">, </span>viewed
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId(selected.attempt.id)}
            tabIndex={0}
            className="mt-3 rounded-[12px] border border-line-strong bg-paper-raised"
            data-testid="proof-run-result"
          >
            <AttemptResult key={selected.attempt.id} item={selected} animate={animate} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AttemptResult({ item, animate }: { item: PlaybackAttempt; animate: boolean }) {
  const { attempt, transcript } = item;
  const outcome = outcomeFor(transcript.result);
  const tone = TONE[outcome.tone];
  const stamp = animate
    ? outcome.tone === "executed"
      ? "proof-run-stamp-allow"
      : outcome.tone === "blocked"
        ? "proof-run-stamp-block"
        : ""
    : "";

  return (
    <div className={`border-l-4 ${tone.rule} rounded-[12px] p-4 sm:p-5 ${animate ? "proof-run-enter" : ""}`}>
      <p className="text-[13px] text-ink-soft">Result</p>
      <p
        className={`mt-1 flex items-center gap-2 text-[20px] font-semibold leading-tight ${tone.text}`}
        data-testid="proof-run-outcome"
      >
        <Icon name={tone.icon} size={22} className={stamp} />
        {outcome.label}
      </p>
      <p className="mt-1 text-[14px] leading-[1.5] text-ink">{describeResult(transcript.result)}</p>

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 text-[14px] leading-[1.5] sm:grid-cols-[9.5rem_minmax(0,1fr)]">
        <dt className="text-ink-soft">Attempted change</dt>
        <dd className="min-w-0">
          <code className="font-mono-code text-[13px] text-ink">{attempt.tool}</code>
          <ul className="mt-1 flex flex-col gap-0.5">
            {item.arguments.map((arg) => (
              <li key={arg.key} className="break-words text-ink">
                <span className="font-mono-code text-[12.5px] text-ink-soft">{arg.key}:</span> {arg.display}
                {arg.display !== arg.raw ? (
                  <span className="font-mono-code text-[12px] text-ink-soft"> ({arg.raw})</span>
                ) : null}
              </li>
            ))}
          </ul>
          {item.afterLabel ? (
            <p className="mt-1 text-[13px] text-ink-soft">
              Same task, right after &ldquo;{item.afterLabel}&rdquo;.
            </p>
          ) : null}
        </dd>

        <dt className="text-ink-soft">Authority decision</dt>
        <dd className="min-w-0 text-ink">
          <span className="font-medium">{decisionLabel(transcript.decision)}</span>{" "}
          <code className="font-mono-code text-[12.5px] text-ink-soft">{transcript.decision}</code>
        </dd>

        <dt className="text-ink-soft">Reason</dt>
        <dd className="min-w-0 text-ink">
          <span className="flex flex-wrap gap-1.5">
            {transcript.reasonCodes.map((code) => (
              <code
                key={code}
                className="rounded-[6px] border border-line bg-paper px-1.5 py-0.5 font-mono-code text-[12px] text-ink"
              >
                {code}
              </code>
            ))}
          </span>
          <span className="mt-1 block" data-testid="proof-run-reason">
            {reasonSentence(transcript)}
          </span>
        </dd>

        <dt className="text-ink-soft">Dispatch</dt>
        <dd className="min-w-0 text-ink" data-testid="proof-run-dispatch">
          {dispatchStatus(transcript.dispatches)}
        </dd>

        <dt className="text-ink-soft">Receipt</dt>
        <dd className="min-w-0 text-ink" data-testid="proof-run-receipt">
          {transcript.receipt ? (
            <>
              <code className="font-mono-code text-[13px]">{transcript.receipt.receiptId}</code>
              <span className="text-ink-soft"> · provider result: {transcript.receipt.result}</span>
            </>
          ) : (
            <span className="text-ink-soft">
              {transcript.dispatches === 0
                ? "None. Nothing reached the provider, so there is no receipt."
                : "None. The provider did not confirm a write."}
            </span>
          )}
        </dd>
      </dl>
    </div>
  );
}
