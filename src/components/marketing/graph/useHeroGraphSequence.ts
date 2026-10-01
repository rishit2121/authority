import { useEffect, useRef, useState } from "react";

export type HeroGraphPhase = "idle" | "allow" | "retract" | "revoked";

const PHASE_ORDER: HeroGraphPhase[] = ["idle", "allow", "retract", "revoked"];

/** Milliseconds per phase — tuned for the spec's ~7-9s full cycle, then it loops. */
const PHASE_DURATIONS: Record<HeroGraphPhase, number> = {
  idle: 700,
  allow: 4200,
  retract: 900,
  revoked: 1200,
};

/**
 * Drives the hero graph's continuously looping sequence: idle, then required
 * paths allow while Slack is blocked, then permissions retract and the
 * "revoked" state holds briefly before looping back to idle. `paused` comes
 * only from the graph's own explicit Pause/Resume control now — hover and
 * focus no longer pause it, since that produced confusing mid-sequence
 * screenshots. `reducedMotion` skips the loop entirely and holds the
 * completed "revoked" state.
 */
export function useHeroGraphSequence(paused: boolean, reducedMotion: boolean) {
  const [phase, setPhase] = useState<HeroGraphPhase>(reducedMotion ? "revoked" : "idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      setPhase("revoked");
      return;
    }
    if (paused) return;

    const duration = PHASE_DURATIONS[phase];
    timeoutRef.current = setTimeout(() => {
      const nextIndex = (PHASE_ORDER.indexOf(phase) + 1) % PHASE_ORDER.length;
      setPhase(PHASE_ORDER[nextIndex]);
    }, duration);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [phase, paused, reducedMotion]);

  return { phase };
}
