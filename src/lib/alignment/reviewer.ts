import { createHash } from "node:crypto";

import type { z } from "zod";

import { getOpenAiEnv } from "@/lib/ai/env";

import { PRODUCTION_PROMPT_VERSION, REFERENCE_PROMPT_VERSION } from "./prompts";

/**
 * The model behind task-alignment review.
 *
 * Every call is isolated: one system and one user message, a strict JSON
 * schema, no tools, no conversation history, no secrets in the prompt. The
 * reviewer reads hostile text, so its output is only ever parsed against a
 * schema and treated as data; nothing it returns is executed.
 *
 * Failures are typed, never a pass: a timeout, an unavailable provider, an
 * exhausted quota or budget, or output that does not match the schema all
 * come back as `{ ok: false, reason }`, which the callers turn into an
 * "unreviewed" outcome.
 */

export type ReviewerFailure =
  "timeout" | "unavailable" | "malformed" | "refused" | "quota_exhausted" | "budget_exhausted" | "error";

export interface ReviewerUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export type ReviewerResult<T> =
  | { ok: true; data: T; usage: ReviewerUsage; model: string }
  | { ok: false; reason: ReviewerFailure; usage: ReviewerUsage };

export interface ReviewerRequest<T> {
  /** Schema name, also used by fixtures to pick a response. */
  name: string;
  system: string;
  user: string;
  /** Strict JSON schema (object at the top level, every property required, no extra properties). */
  jsonSchema: Record<string, unknown>;
  parse: z.ZodType<T>;
}

export interface AlignmentReviewer {
  readonly model: string;
  call<T>(request: ReviewerRequest<T>): Promise<ReviewerResult<T>>;
}

export const EMPTY_USAGE: ReviewerUsage = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };

export function addUsage(a: ReviewerUsage, b: ReviewerUsage): ReviewerUsage {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    latencyMs: a.latencyMs + b.latencyMs,
  };
}

/** Identifies exactly which reviewer produced a piece of evidence: model plus prompt versions. */
export function reviewerConfig(model: string): { model: string; prompts: string; configHash: string } {
  const prompts = `${REFERENCE_PROMPT_VERSION}+${PRODUCTION_PROMPT_VERSION}`;
  const configHash = createHash("sha256").update(JSON.stringify({ model, prompts })).digest("hex");
  return { model, prompts, configHash };
}

const MAX_RESPONSE_CHARS = 24_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface OpenAiReviewerOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** Extra attempts after a transient network/5xx failure. Never after a 4xx or a quota error. */
  retries?: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

/** Chat Completions with `response_format: json_schema, strict: true` (verified supported by the configured model). */
export class OpenAiAlignmentReviewer implements AlignmentReviewer {
  readonly model: string;
  constructor(private readonly options: OpenAiReviewerOptions) {
    this.model = options.model;
  }

  async call<T>(request: ReviewerRequest<T>): Promise<ReviewerResult<T>> {
    const attempts = 1 + Math.max(0, this.options.retries ?? 1);
    let usage = { ...EMPTY_USAGE };
    let last: ReviewerFailure = "error";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const started = Date.now();
      const outcome = await this.once(request);
      usage = addUsage(usage, {
        calls: 1,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        latencyMs: Date.now() - started,
      });
      if (outcome.ok) return { ok: true, data: outcome.data, usage, model: outcome.model };
      last = outcome.reason;
      if (!outcome.transient) break;
    }
    return { ok: false, reason: last, usage };
  }

  private async once<T>(
    request: ReviewerRequest<T>,
  ): Promise<
    | { ok: true; data: T; model: string; inputTokens: number; outputTokens: number }
    | { ok: false; reason: ReviewerFailure; transient: boolean; inputTokens: number; outputTokens: number }
  > {
    const fail = (reason: ReviewerFailure, transient = false, inputTokens = 0, outputTokens = 0) =>
      ({ ok: false, reason, transient, inputTokens, outputTokens }) as const;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await (this.options.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: request.name, strict: true, schema: request.jsonSchema },
          },
          max_completion_tokens: this.options.maxOutputTokens ?? 2_000,
          store: false,
        }),
      });
      const text = await res.text();
      if (res.status === 429) {
        // A per-day request cap is not worth retrying within a request; a per-minute one might clear, but
        // retrying would spend the same scarce budget, so neither is retried here.
        return fail(/per day|RPD|quota/i.test(text) ? "quota_exhausted" : "unavailable");
      }
      if (res.status >= 500) return fail("unavailable", true);
      if (!res.ok) return fail("error");
      if (text.length > MAX_RESPONSE_CHARS * 4) return fail("malformed");
      const body = JSON.parse(text) as {
        model?: string;
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const inTok = body.usage?.prompt_tokens ?? 0;
      const outTok = body.usage?.completion_tokens ?? 0;
      const message = body.choices?.[0]?.message;
      if (message?.refusal) return fail("refused", false, inTok, outTok);
      const content = message?.content;
      if (typeof content !== "string" || content.length > MAX_RESPONSE_CHARS)
        return fail("malformed", false, inTok, outTok);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(content);
      } catch {
        return fail("malformed", false, inTok, outTok);
      }
      const parsed = request.parse.safeParse(parsedJson);
      if (!parsed.success) return fail("malformed", false, inTok, outTok);
      return {
        ok: true,
        data: parsed.data,
        model: body.model ?? this.options.model,
        inputTokens: inTok,
        outputTokens: outTok,
      };
    } catch (error) {
      if (controller.signal.aborted) return fail("timeout");
      return fail(error instanceof SyntaxError ? "malformed" : "unavailable", true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Caps calls (including retries) and tokens across a run. Once spent, every
 * further call fails with `budget_exhausted` -- and after a provider reports
 * its daily quota is gone, so does every later call, without sending it.
 */
export class BudgetedReviewer implements AlignmentReviewer {
  readonly model: string;
  used: ReviewerUsage = { ...EMPTY_USAGE };
  quotaExhausted = false;

  constructor(
    private readonly inner: AlignmentReviewer,
    private readonly budget: { maxCalls: number; maxTokens?: number },
  ) {
    this.model = inner.model;
  }

  get remainingCalls(): number {
    return Math.max(0, this.budget.maxCalls - this.used.calls);
  }

  async call<T>(request: ReviewerRequest<T>): Promise<ReviewerResult<T>> {
    const tokensSpent = this.used.inputTokens + this.used.outputTokens;
    if (
      this.quotaExhausted ||
      this.used.calls >= this.budget.maxCalls ||
      (this.budget.maxTokens !== undefined && tokensSpent >= this.budget.maxTokens)
    ) {
      return {
        ok: false,
        reason: this.quotaExhausted ? "quota_exhausted" : "budget_exhausted",
        usage: { ...EMPTY_USAGE },
      };
    }
    const result = await this.inner.call(request);
    this.used = addUsage(this.used, result.usage);
    if (!result.ok && result.reason === "quota_exhausted") this.quotaExhausted = true;
    return result;
  }
}

/** The configured reviewer, or null when no OpenAI key is set (callers then record "unreviewed"). */
export function createAlignmentReviewer(
  env: Record<string, string | undefined> = process.env,
): AlignmentReviewer | null {
  const openAi = getOpenAiEnv(env);
  if (!openAi) return null;
  const timeoutMs = Number(env.ALIGNMENT_REVIEW_TIMEOUT_MS);
  return new OpenAiAlignmentReviewer({
    apiKey: openAi.apiKey,
    model: openAi.model,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 60_000) : DEFAULT_TIMEOUT_MS,
    retries: 1,
  });
}
