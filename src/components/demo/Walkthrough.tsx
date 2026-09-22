"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { DecisionStatusBadge } from "@/components/ui/DecisionStatusBadge";
import { Icon } from "@/components/ui/Icon";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { WALKTHROUGH_STEPS } from "@/lib/data/demo-walkthrough";

const ACTOR_LABEL = {
  user: "Human principal",
  authority: "Authority",
  agent: "Customer agent",
} as const;

const ACTOR_CLASSES = {
  user: "border-allow/35 bg-allow/10 text-allow",
  authority: "border-primary/30 bg-primary/10 text-primary",
  agent: "border-secondary/40 bg-secondary/10 text-secondary",
} as const;

/**
 * Guided walkthrough of one authorization pass.
 *
 * Steps are driven by keyboard as well as pointer: left/right arrows and
 * Home/End move through them while the region has focus. Framer Motion
 * handles the transitions, with `MotionConfig reducedMotion="user"` deferring
 * to the OS setting.
 */
export function Walkthrough() {
  const [index, setIndex] = useState(0);
  const reducedMotion = useReducedMotion();
  const regionRef = useRef<HTMLDivElement>(null);

  const total = WALKTHROUGH_STEPS.length;
  const step = WALKTHROUGH_STEPS[index];

  const goTo = useCallback((next: number) => setIndex(Math.min(total - 1, Math.max(0, next))), [total]);
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const previous = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const handlers: Record<string, () => void> = {
        ArrowRight: next,
        ArrowLeft: previous,
        Home: () => goTo(0),
        End: () => goTo(total - 1),
      };
      const handler = handlers[event.key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };

    region.addEventListener("keydown", onKeyDown);
    return () => region.removeEventListener("keydown", onKeyDown);
  }, [next, previous, goTo, total]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={regionRef}
        tabIndex={-1}
        role="group"
        aria-roledescription="walkthrough"
        aria-label="Runtime authorization walkthrough"
        className="rounded-xl border border-outline-variant/30 bg-surface-container"
      >
        {/* Step indicator */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-outline-variant/25 px-space-lg py-space-md">
          {WALKTHROUGH_STEPS.map((candidate, candidateIndex) => {
            const active = candidateIndex === index;
            const visited = candidateIndex < index;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => goTo(candidateIndex)}
                aria-current={active ? "step" : undefined}
                aria-label={`Step ${candidateIndex + 1} of ${total}: ${candidate.title}`}
                className={`rounded px-2 py-1 font-mono-code text-[11px] transition-colors ${
                  active
                    ? "bg-primary text-on-primary"
                    : visited
                      ? "text-allow hover:bg-surface-container-high"
                      : "text-outline hover:bg-surface-container-high hover:text-on-surface-variant"
                }`}
              >
                {candidateIndex + 1}. {candidate.label}
              </button>
            );
          })}
        </div>

        <div className="p-space-lg md:p-space-xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <div className="flex flex-wrap items-center gap-space-sm">
                <span
                  className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${ACTOR_CLASSES[step.actor]}`}
                >
                  {ACTOR_LABEL[step.actor]}
                </span>
                {step.decision ? <DecisionStatusBadge status={step.decision} /> : null}
                <span className="font-mono-code text-[11px] text-outline">
                  Step {index + 1} of {total}
                </span>
              </div>

              <h2 className="mt-space-md font-headline-lg text-[1.5rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[1.875rem]">
                {step.title}
              </h2>
              <p className="mt-space-sm max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
                {step.body}
              </p>

              {step.code ? (
                <pre className="mt-space-lg overflow-x-auto rounded-lg border border-outline-variant/25 bg-code-surface-deep p-space-md font-mono-code text-[12px] leading-relaxed text-on-surface">
                  <code>
                    {step.code.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </code>
                </pre>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-space-md border-t border-outline-variant/25 px-space-lg py-space-md">
          <span className="flex items-center gap-space-sm">
            <button
              type="button"
              onClick={previous}
              disabled={index === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface-container px-space-lg py-2 font-body-md text-body-md text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="arrow_forward" size={15} className="rotate-180" />
              Previous
            </button>
            <button
              type="button"
              onClick={next}
              disabled={index === total - 1}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-lg py-2 font-headline-sm text-body-md font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <Icon name="arrow_forward" size={15} />
            </button>
            <button
              type="button"
              onClick={() => goTo(0)}
              className="rounded-lg border border-outline-variant/40 bg-surface-container px-space-lg py-2 font-body-md text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              Replay
            </button>
          </span>

          <Link
            href="/app/tasks/demo-task"
            className="inline-flex items-center gap-1.5 font-body-md text-body-md text-primary underline-offset-4 hover:underline"
          >
            Open the full task investigation
            <Icon name="arrow_forward" size={15} />
          </Link>
        </div>

        <p className="sr-only" aria-live="polite">
          {reducedMotion ? "" : null}
          Step {index + 1} of {total}: {step.title}. {step.body}
        </p>
      </div>
    </MotionConfig>
  );
}
