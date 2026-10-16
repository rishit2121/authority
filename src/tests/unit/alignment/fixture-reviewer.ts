import type {
  AlignmentReviewer,
  ReviewerFailure,
  ReviewerRequest,
  ReviewerResult,
} from "@/lib/alignment/reviewer";

/**
 * A recorded-response reviewer for tests: answers by schema name, validates
 * every answer against the same zod schema production uses, and records what
 * it was sent. Returning a ReviewerFailure string simulates that failure.
 */
export type FixtureHandler = (
  request: ReviewerRequest<unknown>,
  callIndex: number,
) => unknown | ReviewerFailure;

const FAILURES = new Set([
  "timeout",
  "unavailable",
  "malformed",
  "refused",
  "quota_exhausted",
  "budget_exhausted",
  "error",
]);

export class FixtureReviewer implements AlignmentReviewer {
  readonly model = "fixture-model";
  readonly requests: ReviewerRequest<unknown>[] = [];
  constructor(private readonly handler: FixtureHandler) {}

  async call<T>(request: ReviewerRequest<T>): Promise<ReviewerResult<T>> {
    const index = this.requests.length;
    this.requests.push(request as ReviewerRequest<unknown>);
    const usage = { calls: 1, inputTokens: 100, outputTokens: 20, latencyMs: 1 };
    const answer = this.handler(request as ReviewerRequest<unknown>, index);
    if (typeof answer === "string" && FAILURES.has(answer))
      return { ok: false, reason: answer as ReviewerFailure, usage };
    const parsed = request.parse.safeParse(answer);
    if (!parsed.success) return { ok: false, reason: "malformed", usage };
    return { ok: true, data: parsed.data, usage, model: this.model };
  }
}

export function scoresFor(values: number[]) {
  return {
    scores: values.map((v, i) => ({
      user_task_instruction: `t${i}`,
      contribute_to_score: v,
      reason: "fixture",
    })),
  };
}
