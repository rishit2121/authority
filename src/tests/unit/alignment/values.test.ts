import { describe, expect, it } from "vitest";

import { checkCallValues, extractRequestLiterals } from "@/lib/alignment/values";

const check = (
  request: string,
  args: Record<string, unknown>,
  extra: { derived?: string[]; resource?: string[] } = {},
) =>
  checkCallValues(
    {
      stepId: "s1",
      tool: "t.x",
      args,
      derivedKeys: new Set(extra.derived ?? []),
      resourceKeys: new Set(extra.resource ?? []),
    },
    extractRequestLiterals(request),
  );

describe("request literals", () => {
  it("reads amounts in minor units with their currency", () => {
    const lit = extractRequestLiterals(
      "Refund $5 of pi_alex_1, then charge €12.50 and 1,200 dollars; also 300 cents.",
    );
    expect(lit.amounts).toEqual(
      expect.arrayContaining([
        { minor: 500, currency: "usd" },
        { minor: 1250, currency: "eur" },
        { minor: 120000, currency: "usd" },
        { minor: 300, currency: null },
      ]),
    );
    expect([...lit.currencies].sort()).toEqual(["eur", "usd"]);
  });

  it("reads recipients and hosts", () => {
    const lit = extractRequestLiterals("Email Alice@Acme.test the report from https://reports.acme.test/q3");
    expect([...lit.emails]).toEqual(["alice@acme.test"]);
    expect([...lit.hosts]).toEqual(["reports.acme.test"]);
  });
});

describe("deterministic value checks", () => {
  it("flags a recipient the request did not name as a conflict", () => {
    const f = check("Email alice@acme.test that the offsite is Friday.", { to: "eve@evil.test", body: "x" });
    expect(f).toEqual([
      expect.objectContaining({
        type: "wrong_recipient",
        severity: "conflict",
        field: "to",
        source: "deterministic",
      }),
    ]);
  });

  it("accepts the named recipient and ignores free text", () => {
    expect(
      check("Email alice@acme.test that the offsite is Friday.", {
        to: "alice@acme.test",
        body: "send to eve@evil.test",
      }),
    ).toEqual([]);
  });

  it("calls an undetermined recipient unresolved (ambiguous), not wrong", () => {
    const f = check("Send the weekly summary to my manager.", { to: "boss@acme.test" });
    expect(f).toEqual([expect.objectContaining({ type: "unresolved_value", severity: "ambiguous" })]);
  });

  it("skips values bound to an earlier step's output", () => {
    expect(
      check("Reply to the sender of my latest email.", { to: "someone@x.test" }, { derived: ["to"] }),
    ).toEqual([]);
  });

  it("catches the wrong amount even though it is 'related' (50000 cents vs $5)", () => {
    const f = check("Refund $5 of payment pi_alex_1.", { payment_id: "pi_alex_1", amount_cents: 50000 });
    expect(f).toEqual([
      expect.objectContaining({ type: "wrong_amount", severity: "conflict", field: "amount_cents" }),
    ]);
    expect(check("Refund $5 of payment pi_alex_1.", { payment_id: "pi_alex_1", amount_cents: 500 })).toEqual(
      [],
    );
    // A major-unit field matches either reading.
    expect(check("Refund $5 of payment pi_alex_1.", { payment_id: "pi_alex_1", amount: 5 })).toEqual([]);
  });

  it("flags another resource of the same family as wrong", () => {
    const f = check("Refund $5 of payment pi_alex_1.", { payment_id: "pi_bob_1", amount_cents: 500 });
    expect(f).toEqual([expect.objectContaining({ type: "wrong_resource", severity: "conflict" })]);
  });

  it("flags a different channel when the request names one", () => {
    expect(
      check("Post 'Deploy is done.' to #eng-alex.", { channel: "#eng-alex", text: "Deploy is done." }),
    ).toEqual([]);
    expect(
      check("Post 'Deploy is done.' to #eng-alex.", { channel: "C-bob-team", text: "Deploy is done." }),
    ).toEqual([expect.objectContaining({ type: "wrong_channel", severity: "conflict" })]);
  });

  it("flags a currency change", () => {
    expect(check("Refund €10 to cus_1.", { customer_id: "cus_1", amount: 10, currency: "usd" })).toEqual([
      expect.objectContaining({ type: "wrong_currency", severity: "conflict" }),
    ]);
  });

  it("flags a link to a host the request never mentioned", () => {
    expect(
      check("Share https://docs.acme.test/plan with the team.", { url: "https://evil.test/login" }),
    ).toEqual([expect.objectContaining({ type: "unresolved_value", severity: "conflict" })]);
  });
});
