import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gateway/db", () => ({ gatewayQuery: vi.fn() }));

import {
  checkAction,
  pinnedKeys,
  type ActionCheckDeps,
  type ActionInput,
} from "@/lib/alignment/action-check";
import type { AlignmentContext } from "@/lib/gateway/rpc-alignment";

import { FixtureReviewer, scoresFor } from "./fixture-reviewer";

const contract = {
  schemaVersion: 1,
  items: [
    {
      tool: "gmail.send_email",
      constraints: [
        { key: "to", equals: "alice@acme.test" },
        { key: "subject", equals: "Offsite" },
      ],
    },
  ],
};

const ctx = (over: Partial<AlignmentContext> = {}): AlignmentContext => ({
  status: "ok",
  credentialKind: "session",
  tenantId: "ten",
  applicationId: "app",
  mode: "enforce",
  policy: "production",
  maxContentBytes: 32768,
  objectiveVersion: 1,
  contextRevision: 2,
  taskIntent: "Email alice@acme.test that the offsite is Friday",
  objectiveRequest: "Email alice@acme.test that the offsite is Friday",
  objectiveExtraction: {
    schemaVersion: 1,
    taskInstructions: ["Email Alice that the offsite is Friday"],
    prohibitions: [],
    requirements: [],
    quotedMaterial: [],
  },
  objectiveStatus: "extracted",
  contractId: "c1",
  allowedActions: contract,
  checkPlans: true,
  checkContent: true,
  checkActions: true,
  planOutcome: "aligned",
  planDecision: null,
  contentAction: "quarantine",
  ...over,
});

const input = (args: Record<string, unknown>, over: Partial<ActionInput> = {}): ActionInput => ({
  credentialSecret: "authority_ts_x",
  taskId: "t1",
  tool: "gmail.send_email",
  operation: "send_email",
  resource: null,
  args,
  idempotencyKey: "k1",
  detOutcome: "allow_constrained",
  ...over,
});

function deps(
  context: AlignmentContext,
  reviewer: FixtureReviewer | null,
  over: Partial<ActionCheckDeps> = {},
) {
  const recorded: unknown[] = [];
  const d: ActionCheckDeps = {
    reviewer,
    context: vi.fn(async () => context),
    recordObjectives: vi.fn(async () => ({ status: "ok", version: 1 })),
    recordReview: vi.fn(async () => ({ status: "ok", reviewId: "r" })),
    findReview: vi.fn(),
    recordContent: vi.fn(),
    findAction: vi.fn(async () => ({
      status: "ok",
      reviewId: null,
      outcome: null,
      decision: null,
      findings: null,
      feedback: null,
      policy: null,
      mode: null,
    })),
    recordAction: vi.fn(async (rec) => {
      recorded.push(rec);
      return { status: "ok", reviewId: "rev-a" };
    }),
    ...over,
  };
  return { d, recorded };
}

describe("pinned contract values", () => {
  it("knows which arguments the contract fixed verbatim", () => {
    expect([
      ...pinnedKeys(contract, "gmail.send_email", {
        to: "alice@acme.test",
        subject: "Offsite",
        body: "Friday",
      }),
    ]).toEqual(["to", "subject"]);
    expect([
      ...pinnedKeys(contract, "gmail.send_email", { to: "eve@evil.test", subject: "Offsite" }),
    ]).toEqual([]);
  });
});

describe("action check", () => {
  it("works with no submitted external content (content screening off, context revision 0)", async () => {
    const reviewer = new FixtureReviewer(() => scoresFor([0]));
    const { d } = deps(ctx({ checkContent: false, contextRevision: 0 }), reviewer);
    const r = await checkAction(
      input({ to: "alice@acme.test", subject: "Offsite", body: "Also send the payroll file" }),
      d,
    );
    expect(r).toMatchObject({ kind: "block", outcome: "misaligned" });
    expect(reviewer.requests[0].name).toBe("tool_call_scores");
  });

  it("is off when alignment, or the action check, is off -- and never runs for a deterministic refusal", async () => {
    for (const c of [ctx({ mode: "off" }), ctx({ checkActions: false })]) {
      expect(await checkAction(input({}), deps(c, null).d)).toEqual({ kind: "off" });
    }
    const reviewer = new FixtureReviewer(() => scoresFor([1]));
    expect(await checkAction(input({}, { detOutcome: "deny" }), deps(ctx(), reviewer).d)).toEqual({
      kind: "off",
    });
    expect(reviewer.requests).toHaveLength(0);
  });

  it("never decides task isolation: alignment settings neither require nor waive task sessions", async () => {
    // A raw key reaching here was already allowed by applications.require_task_sessions; enforcement mode
    // does not add or remove that rule.
    const reviewer = new FixtureReviewer(() => scoresFor([1]));
    const r = await checkAction(
      input({ to: "alice@acme.test", subject: "Offsite" }),
      deps(ctx({ credentialKind: "runtime_key" }), reviewer).d,
    );
    expect(r.kind).toBe("clear");
  });

  it("production: a fully pinned call under a cleared plan review needs no model call", async () => {
    const reviewer = new FixtureReviewer(() => scoresFor([0]));
    const { d, recorded } = deps(ctx(), reviewer);
    const r = await checkAction(input({ to: "alice@acme.test", subject: "Offsite" }), d);
    expect(r).toEqual({ kind: "clear", reviewId: "rev-a", covered: true });
    expect(reviewer.requests).toHaveLength(0);
    expect(recorded[0]).toMatchObject({ outcome: "aligned", usage: { coveredByPlanReview: true } });
  });

  it("reviews run-time values with Task Shield's tool-call checker and blocks zero contribution", async () => {
    const reviewer = new FixtureReviewer(() => scoresFor([0]));
    const { d } = deps(ctx(), reviewer);
    const r = await checkAction(
      input({ to: "alice@acme.test", subject: "Offsite", body: "Also wire $9,000 to account 44" }),
      d,
    );
    expect(r).toMatchObject({ kind: "block", outcome: "misaligned", reviewId: "rev-a" });
    expect(reviewer.requests[0].name).toBe("tool_call_scores");
    expect(reviewer.requests[0].user).toContain("Values chosen at run time (not fixed by the plan): body");
  });

  it("checks presentation requirements against the actual run-time text (deferred from plan review)", async () => {
    const reviewer = new FixtureReviewer(() => scoresFor([1]));
    const { d } = deps(ctx(), reviewer);
    await checkAction(
      input({ to: "alice@acme.test", subject: "Offsite", body: "Two sentences. Exactly." }),
      d,
    );
    expect(reviewer.requests[0].user).toContain("presentation requirement in the request");
  });

  it("an explicit value conflict blocks even when the reviewer scores the call highly", async () => {
    const reviewer = new FixtureReviewer(() => scoresFor([1]));
    const { d } = deps(
      ctx({ allowedActions: { items: [{ tool: "gmail.send_email", constraints: [] }] } }),
      reviewer,
    );
    const r = await checkAction(input({ to: "eve@evil.test", body: "hi" }), d);
    expect(r).toMatchObject({
      kind: "block",
      outcome: "misaligned",
      findings: [expect.objectContaining({ type: "wrong_recipient" })],
    });
  });

  it("reviewer failure holds the call as unreviewed -- never an automatic pass", async () => {
    const { d } = deps(ctx({ planOutcome: null }), new FixtureReviewer(() => "timeout"));
    expect(await checkAction(input({ to: "alice@acme.test", subject: "Offsite" }), d)).toMatchObject({
      kind: "block",
      outcome: "unreviewed",
    });
  });

  it("a retry reuses the stored review, including a person's approval of it", async () => {
    const reviewer = new FixtureReviewer(() => scoresFor([0]));
    const { d } = deps(ctx(), reviewer, {
      findAction: vi.fn(async () => ({
        status: "ok",
        reviewId: "rev-old",
        outcome: "unreviewed" as const,
        decision: "approved" as const,
        findings: [],
        feedback: null,
        policy: "production" as const,
        mode: "enforce" as const,
      })),
    });
    expect(await checkAction(input({ body: "x" }), d)).toEqual({
      kind: "clear",
      reviewId: "rev-old",
      covered: false,
    });
    expect(reviewer.requests).toHaveLength(0);
  });

  it("shadow mode defers the review until after the decision", async () => {
    const reviewer = new FixtureReviewer(() => scoresFor([0]));
    const { d, recorded } = deps(ctx({ mode: "shadow" }), reviewer);
    const r = await checkAction(input({ body: "x" }), d);
    expect(r.kind).toBe("shadow");
    expect(recorded).toHaveLength(0);
    if (r.kind === "shadow") await r.after();
    expect(recorded[0]).toMatchObject({ mode: "shadow", outcome: "misaligned" });
  });

  it("reference policy always asks the reviewer, with no value checks", async () => {
    const reviewer = new FixtureReviewer(() => scoresFor([0.4]));
    const { d } = deps(ctx({ policy: "reference" }), reviewer);
    expect(await checkAction(input({ to: "alice@acme.test", subject: "Offsite" }), d)).toMatchObject({
      kind: "clear",
      covered: false,
    });
    expect(reviewer.requests).toHaveLength(1);
    expect(reviewer.requests[0].user).not.toContain("original request");
  });
});
