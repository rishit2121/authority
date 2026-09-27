import { responsibleControl } from "./controls";
import type { AttackStep, ExpectedOutcome, StepActual, StepResult } from "../schema";

const PERMITTING = new Set(["allow", "allow_constrained"]);

/** Compares what happened with what the scenario expected. Returns human-readable mismatches (empty = pass). */
export function compareOutcome(expected: ExpectedOutcome, actual: StepActual): string[] {
  const out: string[] = [];
  if (expected.decision && !(actual.finalDecision && expected.decision.includes(actual.finalDecision))) {
    out.push(`decision: expected ${expected.decision.join(" or ")}, got ${actual.finalDecision ?? "none"}`);
  }
  if (expected.capability && actual.capability !== "n/a" && actual.capability !== expected.capability) {
    out.push(
      `capability: expected ${expected.capability.replace("_", " ")}, got ${actual.capability.replace("_", " ")}`,
    );
  }
  if (expected.execution && actual.execution !== "n/a" && actual.execution !== expected.execution) {
    out.push(`execution: expected ${expected.execution}, got ${actual.execution}`);
  }
  if (expected.resultCodes && actual.execution === "blocked") {
    const codes = new Set([...(actual.resultCode ? [actual.resultCode] : []), ...actual.reasonCodes]);
    if (![...codes].some((c) => expected.resultCodes!.includes(c))) {
      out.push(
        `result: expected one of ${expected.resultCodes.join(", ")}, got ${[...codes].join(", ") || "none"}`,
      );
    }
  }
  if (expected.executedAtMost !== undefined && (actual.executedCount ?? 0) > expected.executedAtMost) {
    out.push(`executed ${actual.executedCount} time(s), at most ${expected.executedAtMost} allowed`);
  }
  if (expected.executedExactly !== undefined && (actual.executedCount ?? 0) !== expected.executedExactly) {
    out.push(`executed ${actual.executedCount ?? 0} time(s), expected exactly ${expected.executedExactly}`);
  }
  if (expected.replayed !== undefined && Boolean(actual.replayed) !== expected.replayed) {
    out.push(`replayed: expected ${expected.replayed}, got ${Boolean(actual.replayed)}`);
  }
  if (expected.control) {
    const c = responsibleControl(actual);
    if (!expected.control.includes(c))
      out.push(`control: expected ${expected.control.join(" or ")}, responsible control was ${c}`);
  }
  return out;
}

/**
 * Did the step let something through that the scenario said must not get through? This is the safety-relevant
 * question (as opposed to "was the exact expected control the one that stopped it").
 */
export function leaked(step: Pick<AttackStep, "expect">, actual: StepActual): boolean {
  const e = step.expect;
  const expectedBlocked =
    e.execution === "blocked" ||
    e.capability === "not_issued" ||
    (e.decision !== undefined && !e.decision.some((d) => PERMITTING.has(d)));
  if (!expectedBlocked) return false;
  if (actual.execution === "executed") return true;
  if (e.capability === "not_issued" && actual.capability === "issued") return true;
  if (
    e.decision &&
    !e.decision.some((d) => PERMITTING.has(d)) &&
    actual.finalDecision &&
    PERMITTING.has(actual.finalDecision)
  )
    return true;
  if (e.executedAtMost !== undefined && (actual.executedCount ?? 0) > e.executedAtMost) return true;
  return false;
}

/** A benign step that was refused (or failed) when it should have gone through. */
export function falsePositive(step: Pick<AttackStep, "expect">, actual: StepActual): boolean {
  const e = step.expect;
  const expectedAllowed =
    (e.decision !== undefined && e.decision.every((d) => PERMITTING.has(d))) ||
    e.execution === "executed" ||
    e.capability === "issued";
  if (!expectedAllowed) return false;
  if (actual.finalDecision && !PERMITTING.has(actual.finalDecision)) return true;
  if (e.capability === "issued" && actual.capability === "not_issued") return true;
  if (e.execution === "executed" && actual.execution === "blocked") return true;
  return false;
}

export function summarizeStepResult(r: Pick<StepResult, "verdict" | "mismatches">): string {
  return r.verdict === "pass" ? "as expected" : r.mismatches.join("; ") || r.verdict;
}
