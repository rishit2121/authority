import "server-only";

import { z } from "zod";

import { candidatePlanSchema } from "@/lib/domain";

import { getOpenAiEnv } from "./env";
import {
  PlanProposalOutputTooLargeError,
  PlanProposalProviderError,
  PlanProposalTimeoutError,
  type PlanProposalProvider,
  type PlanProposalResult,
  type TrustedTaskInput,
} from "./plan-proposal-provider";

export const OPENAI_PROVIDER_VERSION = "authority-openai-provider-2026-09-25";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_CHARS = 32_000;
const MAX_RETRIES = 1;

const CANDIDATE_PLAN_JSON_SCHEMA = z.toJSONSchema(candidatePlanSchema);

const SYSTEM_PROMPT = [
  "You propose a structured execution plan for an AI agent. You are not trusted:",
  "every plan you produce is independently re-validated, minimized to the least",
  "authority it needs, and compiled into a contract by deterministic code that",
  "does not read anything you write beyond the plan's structure. You cannot",
  "grant permissions, approve anything, or bypass an organization's policies.",
  "Only use tools named in the provided tool list, with exactly their argument",
  "schema. Never invent a tool. If the task cannot be accomplished with the",
  "given tools, propose the closest safe subset rather than fabricating a tool.",
  "Respond with JSON matching the provided schema and nothing else.",
].join(" ");

function buildUserPrompt(input: TrustedTaskInput): string {
  return JSON.stringify(
    {
      taskId: input.taskId,
      taskIntent: input.taskIntent,
      availableTools: input.availableTools,
      activeOrganizationPolicies: input.policySummaries,
      resourceReferences: input.resourceReferences,
    },
    null,
    2,
  );
}

/**
 * Real OpenAI-backed plan proposal, via a plain `fetch` call rather than the
 * `openai` SDK — this application has no other third-party API client
 * dependency, and the surface used here (one chat-completions call, one
 * timeout, one retry) does not warrant adding one.
 *
 * Structured output is requested via `response_format: json_schema`, but
 * `strict` is left `false`: `candidatePlanSchema` uses Zod defaults on
 * several fields (`dependencies`, `declaredOutputs`, ...), which OpenAI's
 * `strict: true` mode cannot express (it requires every property listed in
 * `required`, even ones with a default). This is a formatting nicety, not
 * the security boundary — `proposePlan()`'s caller always re-validates the
 * parsed JSON against the real `candidatePlanSchema` via Zod regardless of
 * what the API claims to have enforced.
 */
export class OpenAiPlanProposalProvider implements PlanProposalProvider {
  constructor(
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly maxResponseChars: number = MAX_RESPONSE_CHARS,
  ) {}

  async proposePlan(input: TrustedTaskInput): Promise<PlanProposalResult> {
    const env = getOpenAiEnv();
    if (!env) {
      throw new PlanProposalProviderError(
        "OPENAI_API_KEY is not configured; AI-assisted plan generation is unavailable.",
      );
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await this.attempt(env, input);
      } catch (error) {
        lastError = error;
        // Timeouts and malformed/oversized output are not retried — a
        // second attempt would not resolve either, and retrying an
        // ambiguous partial failure risks duplicate side effects on a
        // future version of this provider. Only a transient upstream error
        // (network failure, 5xx) is retried, once.
        if (error instanceof PlanProposalTimeoutError || error instanceof PlanProposalOutputTooLargeError) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error
      ? new PlanProposalProviderError(`OpenAI plan proposal failed after retry: ${lastError.message}`)
      : new PlanProposalProviderError("OpenAI plan proposal failed after retry.");
  }

  private async attempt(
    env: { apiKey: string; model: string },
    input: TrustedTaskInput,
  ): Promise<PlanProposalResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.apiKey}`,
        },
        body: JSON.stringify({
          model: env.model,
          // No `temperature` override: reasoning-tier models (e.g. gpt-6-luna) reject any value other than the
          // default (1) with a 400 `unsupported_value` error — confirmed directly against the real API.
          // Determinism was never a security property here regardless: every proposed plan is untrusted and
          // fully re-validated by `candidatePlanSchema` and the mechanical pipeline no matter what temperature
          // produced it.
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(input) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "candidate_plan", schema: CANDIDATE_PLAN_JSON_SCHEMA, strict: false },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new PlanProposalTimeoutError(`OpenAI request exceeded ${this.timeoutMs}ms`);
      }
      throw new PlanProposalProviderError(
        `OpenAI request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // The response body is never included in the thrown message — it may
      // echo request content back, and this error can surface in logs.
      throw new PlanProposalProviderError(`OpenAI returned status ${response.status}`);
    }

    const rawText = await response.text();
    if (rawText.length > this.maxResponseChars) {
      throw new PlanProposalOutputTooLargeError(
        `OpenAI response exceeded ${this.maxResponseChars} characters`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new PlanProposalProviderError("OpenAI response was not valid JSON");
    }

    const content = extractMessageContent(parsed);
    if (content.length > this.maxResponseChars) {
      throw new PlanProposalOutputTooLargeError(
        `OpenAI message content exceeded ${this.maxResponseChars} characters`,
      );
    }

    let plan: unknown;
    try {
      plan = JSON.parse(content);
    } catch {
      throw new PlanProposalProviderError("OpenAI message content was not valid JSON");
    }

    return {
      plan,
      metadata: { provider: "openai", model: env.model, providerVersion: OPENAI_PROVIDER_VERSION },
    };
  }
}

function extractMessageContent(response: unknown): string {
  if (
    typeof response === "object" &&
    response !== null &&
    "choices" in response &&
    Array.isArray((response as { choices: unknown }).choices)
  ) {
    const first = (response as { choices: unknown[] }).choices[0];
    if (
      typeof first === "object" &&
      first !== null &&
      "message" in first &&
      typeof (first as { message: unknown }).message === "object" &&
      (first as { message: { content?: unknown } }).message !== null
    ) {
      const content = (first as { message: { content?: unknown } }).message.content;
      if (typeof content === "string") return content;
    }
  }
  throw new PlanProposalProviderError("OpenAI response did not contain a message content string");
}
