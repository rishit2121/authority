import { useEffect, useRef, useState } from "react";

export type ScopePhase = "task" | "evaluate" | "illuminate" | "success" | "retract" | "done";

const PHASE_ORDER: ScopePhase[] = ["task", "evaluate", "illuminate", "success", "retract", "done"];

/** Milliseconds spent in each phase before advancing — tuned for a ~6-7s full cycle. */
const PHASE_DURATIONS: Record<ScopePhase, number> = {
  task: 700,
  evaluate: 900,
  illuminate: 2400,
  success: 900,
  retract: 900,
  done: Infinity, // holds until Replay
};

/**
 * Drives the scope graph's phase sequence. Pauses whenever `paused` is true
 * (pointer or focus inside the graph) and never auto-resumes while that
 * holds — matching the "pause on interaction" requirement. `reducedMotion`
 * skips the sequence entirely and jumps straight to the static end state.
 */
export function useScopeSequence(paused: boolean, reducedMotion: boolean) {
  const [phase, setPhase] = useState<ScopePhase>(reducedMotion ? "done" : "task");
  const [cycle, setCycle] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      setPhase("done");
      return;
    }
    if (paused || phase === "done") return;

    const duration = PHASE_DURATIONS[phase];
    timeoutRef.current = setTimeout(() => {
      const next = PHASE_ORDER[PHASE_ORDER.indexOf(phase) + 1] ?? "done";
      setPhase(next);
    }, duration);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // `cycle` is a dependency purely to allow replay() to restart the effect from "task".
  }, [phase, paused, reducedMotion, cycle]);

  function replay() {
    if (reducedMotion) return;
    setPhase("task");
    setCycle((c) => c + 1);
  }

  return { phase, replay };
}
