import { describe, expect, it } from "vitest";

import { BudgetedReviewer, OpenAiAlignmentReviewer } from "@/lib/alignment/reviewer";
import { instructionsJsonSchema, instructionsSchema } from "@/lib/alignment/schemas";

const request = {
  name: "task_instructions",
  system: "sys",
  user: "usr",
  jsonSchema: instructionsJsonSchema,
  parse: instructionsSchema,
};

function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  }) as unknown as typeof fetch;
  return { impl, sent };
}

const completion = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      model: "gpt-6-luna",
      choices: [{ message: { content, ...extra } }],
      usage: { prompt_tokens: 50, completion_tokens: 7 },
    }),
    { status: 200 },
  );

describe("OpenAI alignment reviewer", () => {
  it("sends one isolated strict-schema request with no tools and parses the result", async () => {
    const { impl, sent } = fakeFetch([() => completion('{"instructions":["Do X"]}')]);
    const reviewer = new OpenAiAlignmentReviewer({ apiKey: "k", model: "gpt-6-luna", fetchImpl: impl });
    const r = await reviewer.call(request);
    expect(r).toMatchObject({
      ok: true,
      data: { instructions: ["Do X"] },
      usage: { calls: 1, inputTokens: 50, outputTokens: 7 },
    });
    const body = sent[0].body;
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true, name: "task_instructions" },
    });
    expect(body).not.toHaveProperty("tools");
    expect(body.store).toBe(false);
    expect(body.messages).toHaveLength(2);
  });

  it("never turns bad output into a pass", async () => {
    for (const bad of ["not json", '{"instructions":"nope"}', '{"instructions":[],"extra":1}']) {
      const { impl } = fakeFetch([() => completion(bad)]);
      const r = await new OpenAiAlignmentReviewer({
        apiKey: "k",
        model: "m",
        fetchImpl: impl,
        retries: 0,
      }).call(request);
      expect(r).toMatchObject({ ok: false, reason: "malformed" });
    }
    const { impl } = fakeFetch([() => completion("", { refusal: "I can't" })]);
    expect(
      await new OpenAiAlignmentReviewer({ apiKey: "k", model: "m", fetchImpl: impl }).call(request),
    ).toMatchObject({ ok: false, reason: "refused" });
  });

  it("reports a daily quota without retrying it, and retries a 5xx once (both counted)", async () => {
    const quota = fakeFetch([
      () => new Response('{"error":{"message":"Limit 50 requests per day (RPD)"}}', { status: 429 }),
    ]);
    const r1 = await new OpenAiAlignmentReviewer({
      apiKey: "k",
      model: "m",
      fetchImpl: quota.impl,
      retries: 1,
    }).call(request);
    expect(r1).toMatchObject({ ok: false, reason: "quota_exhausted", usage: { calls: 1 } });

    const flaky = fakeFetch([
      () => new Response("oops", { status: 502 }),
      () => completion('{"instructions":[]}'),
    ]);
    const r2 = await new OpenAiAlignmentReviewer({
      apiKey: "k",
      model: "m",
      fetchImpl: flaky.impl,
      retries: 1,
    }).call(request);
    expect(r2).toMatchObject({ ok: true, usage: { calls: 2 } });
  });

  it("times out instead of waiting forever", async () => {
    const impl = ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      )) as unknown as typeof fetch;
    const r = await new OpenAiAlignmentReviewer({
      apiKey: "k",
      model: "m",
      fetchImpl: impl,
      timeoutMs: 20,
      retries: 0,
    }).call(request);
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
  });
});

describe("budgeted reviewer", () => {
  it("caps calls including retries, and stops for good after a quota error", async () => {
    let n = 0;
    const inner = {
      model: "m",
      call: async () => {
        n += 1;
        return n === 3
          ? ({
              ok: false,
              reason: "quota_exhausted",
              usage: { calls: 1, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
            } as const)
          : ({
              ok: true,
              data: { instructions: [] },
              model: "m",
              usage: { calls: 2, inputTokens: 10, outputTokens: 1, latencyMs: 0 },
            } as const);
      },
    };
    const budgeted = new BudgetedReviewer(inner as never, { maxCalls: 5 });
    expect((await budgeted.call(request)).ok).toBe(true); // 2 calls (one retry)
    expect((await budgeted.call(request)).ok).toBe(true); // 4
    expect(await budgeted.call(request)).toMatchObject({ ok: false, reason: "quota_exhausted" }); // 5
    expect(await budgeted.call(request)).toMatchObject({ ok: false, reason: "quota_exhausted" });
    expect(n).toBe(3);
    expect(budgeted.used.calls).toBe(5);

    const capped = new BudgetedReviewer({ model: "m", call: inner.call } as never, { maxCalls: 0 });
    expect(await capped.call(request)).toMatchObject({ ok: false, reason: "budget_exhausted" });
  });
});
