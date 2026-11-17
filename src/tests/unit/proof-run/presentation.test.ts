import { describe, expect, it } from "vitest";

import {
  decisionLabel,
  dispatchStatus,
  outcomeFor,
  playbackFor,
  provenanceFor,
  REASON_SENTENCES,
  reasonSentence,
  scopeCardFor,
  STALE_RECIPE_WARNING,
} from "@/lib/proof-run/presentation";
import {
  capturedRun,
  engineeringUpdateRecipe,
  type ProofRunRecipe,
  type ProofRunResult,
} from "@/lib/proof-run/recipe";

describe("scopeCardFor", () => {
  it("derives the engineering-update scope card from the recipe", () => {
    const card = scopeCardFor(engineeringUpdateRecipe);
    expect(card.request).toBe("Post one update in #engineering. Don't email anyone.");
    expect(card.rows).toEqual([
      { label: "Tool", value: "slack.post_message", code: true },
      { label: "Destination", value: "#engineering", qualifier: "pinned" },
      { label: "Message text", value: "written by the agent" },
      { label: "Limit", value: "1 post" },
      { label: "Not allowed", value: "email" },
    ]);
  });

  it("follows the recipe when the scope changes", () => {
    const recipe: ProofRunRecipe = structuredClone(engineeringUpdateRecipe);
    recipe.plan[0]!.arguments.channel = "C0GENERAL";
    recipe.plan[0]!.maxInvocations = 3;
    recipe.plan[0]!.agentGenerated = [];
    recipe.attempts = recipe.attempts.filter((a) => a.tool === "slack.post_message");
    const rows = scopeCardFor(recipe).rows;
    expect(rows).toContainEqual({ label: "Destination", value: "#general", qualifier: "pinned" });
    expect(rows).toContainEqual({ label: "Limit", value: "3 posts" });
    expect(rows.find((r) => r.label === "Message text")).toBeUndefined();
    expect(rows.find((r) => r.label === "Not allowed")).toBeUndefined();
  });

  it("shows an unknown channel ID as itself rather than inventing a name", () => {
    const recipe: ProofRunRecipe = structuredClone(engineeringUpdateRecipe);
    recipe.plan[0]!.arguments.channel = "C0UNKNOWN";
    expect(scopeCardFor(recipe).rows).toContainEqual({
      label: "Destination",
      value: "C0UNKNOWN",
      qualifier: "pinned",
    });
  });
});

describe("reasons and outcomes", () => {
  it("maps each reason code in the example to its sentence", () => {
    expect(reasonSentence({ reasonCodes: ["CONSTRAINT_VIOLATION"], summary: "x" })).toBe(
      "The destination is pinned to #engineering; #general is outside the contract.",
    );
    expect(reasonSentence({ reasonCodes: ["INVOCATION_LIMIT_REACHED"], summary: "x" })).toBe(
      "This task allowed one post and it was already used. A new attempt with a new idempotency key is refused, not retried.",
    );
    expect(reasonSentence({ reasonCodes: ["TOOL_NOT_IN_CONTRACT"], summary: "x" })).toBe(
      "Email is not part of this task's contract.",
    );
    expect(reasonSentence({ reasonCodes: ["WITHIN_CONTRACT"], summary: "x" })).toBe(
      "Matches the contract: right tool, pinned destination, budget available.",
    );
  });

  it("falls back to Authority's own summary for an unknown code", () => {
    expect(reasonSentence({ reasonCodes: ["SOMETHING_NEW"], summary: "Authority said no." })).toBe(
      "Authority said no.",
    );
  });

  it("covers every reason code the transcript uses", () => {
    for (const attempt of capturedRun.attempts) {
      for (const code of attempt.reasonCodes) expect(REASON_SENTENCES[code]).toBeDefined();
    }
  });

  it("keeps Allowed, Executed, Blocked before dispatch and Result held distinct", () => {
    const results: ProofRunResult[] = [
      "executed",
      "blocked_before_dispatch",
      "result_held",
      "indeterminate",
      "failed",
    ];
    const labels = results.map((r) => outcomeFor(r).label);
    expect(labels.slice(0, 3)).toEqual(["Executed", "Blocked before dispatch", "Result held"]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain(decisionLabel("allow_constrained"));
    expect(decisionLabel("allow_constrained")).toBe("Allowed");
    expect(decisionLabel("deny")).toBe("Denied");
    expect(decisionLabel("replan")).toBe("Replan required");
    expect(decisionLabel("something_else")).toBe("something_else");
  });

  it("states dispatch in words", () => {
    expect(dispatchStatus(0)).toBe("Not dispatched — blocked before the provider");
    expect(dispatchStatus(1)).toBe("Reached the provider once");
    expect(dispatchStatus(2)).toBe("Reached the provider 2 times");
  });
});

describe("playbackFor", () => {
  it("joins every recipe attempt with its transcript entry, in recipe order, with channel names", () => {
    const rows = playbackFor(engineeringUpdateRecipe, capturedRun);
    expect(rows.map((r) => r.attempt.label)).toEqual([
      "Post to #engineering",
      "Post to #general",
      "Post again to #engineering",
      "Send an email",
    ]);
    expect(rows[1]!.arguments[0]).toEqual({ key: "channel", raw: "C0GENERAL", display: "#general" });
    expect(rows[2]!.afterLabel).toBe("Post to #engineering");
    expect(rows[0]!.transcript.receipt).not.toBeNull();
  });

  it("agrees with each attempt's expectation (the transcript and recipe must not drift)", () => {
    for (const { attempt, transcript } of playbackFor(engineeringUpdateRecipe, capturedRun)) {
      expect(transcript.dispatches).toBe(attempt.expect.dispatches);
      expect(transcript.result === "executed" ? "executed" : "blocked").toBe(attempt.expect.outcome);
      if (attempt.expect.reasonCode) expect(transcript.reasonCodes).toContain(attempt.expect.reasonCode);
    }
  });

  it("throws when the transcript is missing an attempt", () => {
    expect(() => playbackFor(engineeringUpdateRecipe, { ...capturedRun, attempts: [] })).toThrow(
      /no entry for attempt post-engineering/,
    );
  });
});

describe("provenanceFor", () => {
  it("labels an illustrative transcript and never calls it stale", () => {
    const p = provenanceFor({ source: "illustrative", capturedAt: "2026-11-16T00:00:00.000Z" }, false);
    expect(p.badge).toBe("Example run · No accounts connected");
    expect(p.source).toBe("Illustrative transcript");
    expect(p.capturedOn).toBeNull();
    expect(p.staleWarning).toBeNull();
  });

  it("labels a local-fixture capture with its date", () => {
    const p = provenanceFor({ source: "local-fixture", capturedAt: "2026-11-20T10:00:00.000Z" }, true);
    expect(p.source).toBe("Captured from the local fixture run");
    expect(p.capturedOn).toBe("2026-11-20");
    expect(p.staleWarning).toBeNull();
  });

  it("warns when a captured run no longer matches the recipe", () => {
    const p = provenanceFor({ source: "local-fixture", capturedAt: "2026-11-20T10:00:00.000Z" }, false);
    expect(p.staleWarning).toBe(STALE_RECIPE_WARNING);
  });
});
