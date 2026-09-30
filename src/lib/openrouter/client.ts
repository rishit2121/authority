import "server-only";

import { getOpenRouterEnv, type OpenRouterEnv } from "./env";
import {
  errorForStatus,
  OpenRouterMalformedResponseError,
  OpenRouterOutputTooLargeError,
  OpenRouterTimeoutError,
  OpenRouterUnavailableError,
} from "./errors";

const MAX_RESPONSE_CHARS = 32_000;
const DEFAULT_TIMEOUT_MS = 20_000;

/** Every field the caller supplies is treated as untrusted input to serialize; the response is treated as `unknown` until the caller validates it. */
/**
 * The Decisions API lives at `https://openrouter.ai/api/alpha/decisions` — a sibling of `/api/v1`, NOT nested under
 * it (confirmed directly against the live endpoint: `/api/alpha/decisions` answers 401 without a key, while
 * `/api/v1/alpha/decisions` answers 404). `OPENROUTER_BASE_URL` configures the `/v1` chat-completions base; this
 * derives the decisions base from it by stripping a trailing `/v1` rather than hard-coding a second full URL, so a
 * self-hosted-proxy override of the base still reaches the right sibling path.
 */
function decisionsUrl(env: OpenRouterEnv): string {
  return `${env.baseUrl.replace(/\/v\d+\/?$/, "")}/alpha/decisions`;
}

async function postJson(input: {
  env: OpenRouterEnv;
  url: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let timedOut = false;
  controller.signal.addEventListener("abort", () => {
    if (!input.signal?.aborted) timedOut = true;
  });

  let response: Response;
  try {
    response = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.env.apiKey}`,
        ...(input.env.referer ? { "http-referer": input.env.referer } : {}),
        ...(input.env.title ? { "x-title": input.env.title } : {}),
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (input.signal?.aborted && !timedOut) throw error; // caller's own signal, not our deadline — let it propagate as-is
      throw new OpenRouterTimeoutError(`OpenRouter request exceeded ${input.timeoutMs}ms`);
    }
    throw new OpenRouterUnavailableError(
      `OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onOuterAbort);
  }

  if (!response.ok) throw errorForStatus(response.status);

  const rawText = await response.text();
  if (rawText.length > MAX_RESPONSE_CHARS) {
    throw new OpenRouterOutputTooLargeError(`OpenRouter response exceeded ${MAX_RESPONSE_CHARS} characters`);
  }
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new OpenRouterMalformedResponseError("OpenRouter response was not valid JSON");
  }
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature?: number;
  responseFormat?: { type: "json_schema"; json_schema: { name: string; schema: unknown; strict: boolean } };
  timeoutMs?: number;
  signal?: AbortSignal;
  /** `provider.*` routing/privacy controls — see docs/jev/OVERVIEW.md. Omitted entirely unless the tenant/operator opted in. */
  providerRouting?: { data_collection?: "deny"; zdr?: boolean };
}

export interface ChatCompletionResult {
  /** Raw, unvalidated — the caller must parse/validate before trusting anything in it. */
  raw: unknown;
  /** The model OpenRouter says actually answered (`raw.model`), which may differ from the one requested for a router model. */
  respondedModel: string | null;
  content: string;
}

/** Used only for `OPENROUTER_PLAN_MODEL` (a chat-completions-compatible model such as `typesafe/jev-router`). */
export async function callChatCompletions(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
  const env = getOpenRouterEnv();
  if (!env) throw new OpenRouterUnavailableError("OPENROUTER_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: request.model,
    temperature: request.temperature ?? 0,
    messages: request.messages,
  };
  if (request.responseFormat) body.response_format = request.responseFormat;
  if (request.providerRouting) body.provider = request.providerRouting;

  const raw = await postJson({
    env,
    url: `${env.baseUrl}/chat/completions`,
    body,
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: request.signal,
  });

  const content = extractChatContent(raw);
  if (content === null)
    throw new OpenRouterMalformedResponseError("OpenRouter chat response had no message content");
  const respondedModel =
    typeof raw === "object" &&
    raw !== null &&
    "model" in raw &&
    typeof (raw as { model: unknown }).model === "string"
      ? (raw as { model: string }).model
      : null;
  return { raw, respondedModel, content };
}

function extractChatContent(response: unknown): string | null {
  if (typeof response !== "object" || response === null || !("choices" in response)) return null;
  const choices = (response as { choices: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return null;
  const message = (first as { message: unknown }).message;
  if (typeof message !== "object" || message === null || !("content" in message)) return null;
  const content = (message as { content: unknown }).content;
  return typeof content === "string" ? content : null;
}

export interface DecisionQuestion {
  type: "choice" | "noul" | "score";
  instructions: string;
  /** choice: option -> description (<=255 options). noul: optional {true, false}. score: ordered array, 2-10 levels. */
  criteria: Record<string, string> | string[];
}

export interface DecisionsRequest {
  model: string;
  /** Arbitrary trusted JSON context — the "state" Jev evaluates. Never includes secrets, credentials or capability tokens. */
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DecisionsResult {
  /** Raw, unvalidated. */
  raw: unknown;
  /** OpenRouter's versioned model identifier for the request, e.g. "typesafe/jev-1.13-20260917" — the actual routed version. */
  respondedModel: string | null;
  provider: string | null;
  answers: Record<string, unknown>;
  costUsd: number | null;
}

/** The direct Jev structured-decision model, via OpenRouter's separate (alpha) Decisions API — never the chat endpoint. */
export async function callDecisions(request: DecisionsRequest): Promise<DecisionsResult> {
  const env = getOpenRouterEnv();
  if (!env) throw new OpenRouterUnavailableError("OPENROUTER_API_KEY is not configured");

  const raw = await postJson({
    env,
    url: decisionsUrl(env),
    body: { model: request.model, state: request.state, questions: request.questions },
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: request.signal,
  });

  if (typeof raw !== "object" || raw === null || !("answers" in raw)) {
    throw new OpenRouterMalformedResponseError("OpenRouter decisions response had no answers");
  }
  const r = raw as { model?: unknown; provider?: unknown; answers: unknown; usage?: { cost?: unknown } };
  if (typeof r.answers !== "object" || r.answers === null) {
    throw new OpenRouterMalformedResponseError("OpenRouter decisions response's answers were not an object");
  }
  return {
    raw,
    respondedModel: typeof r.model === "string" ? r.model : null,
    provider: typeof r.provider === "string" ? r.provider : null,
    answers: r.answers as Record<string, unknown>,
    costUsd: typeof r.usage?.cost === "number" ? r.usage.cost : null,
  };
}
