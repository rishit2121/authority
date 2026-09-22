"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CAPABILITY_PATHS } from "./graph-data";

/**
 * Phases of one enforcement cycle, run in order and looped.
 *
 * All four capabilities are granted in a single phase — authorization is
 * simultaneous, never a sequential draw-in. The focus phases that follow are
 * a spotlight over already-granted paths, not a reveal.
 */
export type Phase =
  | "idle"
  | "authorize"
  | "focus-postgres-query-order"
  | "focus-stripe-retrieve-payment"
  | "focus-stripe-create-refund"
  | "focus-gmail-send-email"
  | "rejected"
  | "succeeded"
  | "retract";

interface PhaseStep {
  phase: Phase;
  durationMs: number;
}

const SEQUENCE: PhaseStep[] = [
  { phase: "idle", durationMs: 1400 },
  { phase: "authorize", durationMs: 1400 },
  { phase: "focus-postgres-query-order", durationMs: 1100 },
  { phase: "focus-stripe-retrieve-payment", durationMs: 1100 },
  { phase: "focus-stripe-create-refund", durationMs: 1100 },
  { phase: "focus-gmail-send-email", durationMs: 1100 },
  { phase: "rejected", durationMs: 1100 },
  { phase: "succeeded", durationMs: 1100 },
  { phase: "retract", durationMs: 1500 },
];

const PHASE_ORDER = SEQUENCE.map((step) => step.phase);
const AUTHORIZE_INDEX = PHASE_ORDER.indexOf("authorize");
const FIRST_FOCUS_INDEX = PHASE_ORDER.indexOf("focus-postgres-query-order");
const REJECTED_INDEX = PHASE_ORDER.indexOf("rejected");

/** Focus phase belonging to each capability path, keyed by path id. */
const FOCUS_PHASE: Record<string, Phase> = {
  "postgres-query-order": "focus-postgres-query-order",
  "stripe-retrieve-payment": "focus-stripe-retrieve-payment",
  "stripe-create-refund": "focus-stripe-create-refund",
  "gmail-send-email": "focus-gmail-send-email",
};

/**
 * Per-path visual state.
 * `dim` is the connected-but-unauthorized resting state every service starts in.
 */
export type EdgeState = "dim" | "lit" | "focused" | "dimmed" | "succeeded" | "retracting";

/** The proposed-but-refused call. */
export type UnauthorizedState = "dim" | "proposed" | "gone";

export interface SequenceState {
  phase: Phase;
  edgeStates: Record<string, EdgeState>;
  unauthorized: UnauthorizedState;
  liveCapabilities: number;
  revokedCapabilities: number;
}

function deriveState(phase: Phase): SequenceState {
  const index = PHASE_ORDER.indexOf(phase);
  const retracting = phase === "retract";
  const succeeded = phase === "succeeded";
  const authorized = index >= AUTHORIZE_INDEX && !retracting;
  const focusing = index >= FIRST_FOCUS_INDEX && index < REJECTED_INDEX;

  const edgeStates: Record<string, EdgeState> = {};
  for (const path of CAPABILITY_PATHS) {
    if (retracting) {
      edgeStates[path.id] = "retracting";
    } else if (!authorized) {
      edgeStates[path.id] = "dim";
    } else if (succeeded) {
      edgeStates[path.id] = "succeeded";
    } else if (phase === FOCUS_PHASE[path.id]) {
      edgeStates[path.id] = "focused";
    } else if (focusing) {
      edgeStates[path.id] = "dimmed";
    } else {
      edgeStates[path.id] = "lit";
    }
  }

  let unauthorized: UnauthorizedState = "dim";
  if (!retracting && index >= REJECTED_INDEX) unauthorized = "gone";
  else if (!retracting && index >= AUTHORIZE_INDEX) unauthorized = "proposed";

  const held = Object.values(edgeStates).filter((s) => s !== "dim" && s !== "retracting").length;

  return {
    phase,
    edgeStates,
    unauthorized,
    liveCapabilities: retracting ? 0 : held,
    revokedCapabilities: retracting ? CAPABILITY_PATHS.length : 0,
  };
}

/** Resolved end-of-task state shown when motion is reduced. */
export const STATIC_STATE: SequenceState = { ...deriveState("succeeded"), unauthorized: "gone" };

export interface SequenceControls extends SequenceState {
  /** Restart the cycle from the beginning and resume playback. */
  replay: () => void;
}

/**
 * Advances through `SEQUENCE` on a timer.
 *
 * Holds position while `paused` — the graph must not move on under someone
 * who is inspecting it — and does nothing at all when `animate` is false, in
 * which case the caller renders `STATIC_STATE`.
 */
export function useAuthoritySequence(animate: boolean, paused: boolean): SequenceControls {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!animate || paused) return;

    let current = index;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      current = (current + 1) % SEQUENCE.length;
      setIndex(current);
      timer = setTimeout(tick, SEQUENCE[current].durationMs);
    };

    timer = setTimeout(tick, SEQUENCE[current].durationMs);
    return () => clearTimeout(timer);
    // `index` is deliberately excluded: the loop owns its cursor, and
    // re-running on every phase change would restart the timer mid-phase.
    // Pausing re-reads the current index because `paused` is in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, paused]);

  const replay = useCallback(() => setIndex(0), []);
  const live = useMemo(() => deriveState(SEQUENCE[index].phase), [index]);

  return animate ? { ...live, replay } : { ...STATIC_STATE, replay };
}

export const PHASE_LABELS: Record<Phase, string> = {
  idle: "Connected · no task authority",
  authorize: "Minting minimum authority",
  "focus-postgres-query-order": "postgres.query_order",
  "focus-stripe-retrieve-payment": "stripe.retrieve_payment",
  "focus-stripe-create-refund": "stripe.create_refund",
  "focus-gmail-send-email": "gmail.send_email",
  rejected: "slack.send_message — out of scope",
  succeeded: "Task complete · verifying trace",
  retract: "Retracting capabilities",
};
