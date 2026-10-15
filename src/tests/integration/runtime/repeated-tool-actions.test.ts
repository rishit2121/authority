import { afterEach, afterAll, describe, expect, it } from "vitest";

import { closeGatewayPool } from "@/lib/gateway/db";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import { createGatewayFixture, type GatewayFixture } from "../gateway-support";

/**
 * A plan that uses one tool twice with different arguments ("email Alice,
 * then email Bob") compiles to two allowed actions. The runtime must honor
 * each one exactly: each recipient allowed once, neither twice, nobody else
 * ever. Before 20261015000001 the compiler merged them into one action
 * (budget 2, recipient = the last one), so Alice was refused and Bob could be
 * emailed twice -- found by the playground's evaluation console.
 */

const emailTo = (to: string) => ({
  tool: "gmail.send_email",
  constraints: [
    { key: "body", equals: "Offsite is Friday." },
    { key: "subject", equals: "Offsite" },
    { key: "to", equals: to },
  ],
  maxInvocations: 1,
});

const twoRecipients = JSON.stringify({
  schemaVersion: 1,
  items: [emailTo("alice@acme.test"), emailTo("bob@acme.test")],
});

let seq = 0;
const key = () => `repeated-tool-${Date.now()}-${++seq}`;

function authorize(fx: GatewayFixture, to: string) {
  return authorizeThroughGateway({
    credentialSecret: fx.secret,
    taskId: fx.taskId,
    tool: "gmail.send_email",
    operation: "send_email",
    resource: to,
    arguments: { to, subject: "Offsite", body: "Offsite is Friday." },
    idempotencyKey: key(),
    maxUses: 1,
    registryVersion: "rv1",
    compilerVersion: "cv1",
  });
}

const outcome = (r: Awaited<ReturnType<typeof authorize>>) =>
  r.kind === "decision"
    ? { status: r.commit.finalOutcome, codes: r.commit.reasonCodes, token: Boolean(r.capabilityToken) }
    : { status: r.status, codes: [], token: false };

describe("a tool used twice with different arguments", () => {
  const fixtures: GatewayFixture[] = [];
  const mk = async (actions: string) => {
    const fx = await createGatewayFixture({ label: "repeated-tool", actions, maxToolInvocations: 10 });
    fixtures.push(fx);
    return fx;
  };

  afterEach(async () => {
    while (fixtures.length) await fixtures.pop()!.cleanup();
  });
  afterAll(async () => {
    await closeGatewayPool();
  });

  it("allows each planned recipient -- the first one included", async () => {
    const fx = await mk(twoRecipients);
    const alice = outcome(await authorize(fx, "alice@acme.test"));
    const bob = outcome(await authorize(fx, "bob@acme.test"));
    expect(alice).toMatchObject({ status: "allow_constrained", token: true });
    expect(bob).toMatchObject({ status: "allow_constrained", token: true });
  });

  it("allows each recipient only as many times as planned, from its own budget", async () => {
    const fx = await mk(twoRecipients);
    expect(outcome(await authorize(fx, "bob@acme.test")).token).toBe(true);
    const bobAgain = outcome(await authorize(fx, "bob@acme.test"));
    expect(bobAgain.token).toBe(false);
    expect(bobAgain.codes).toContain("INVOCATION_LIMIT_REACHED");
    // Bob using up his own budget never touches Alice's.
    expect(outcome(await authorize(fx, "alice@acme.test")).token).toBe(true);
    const aliceAgain = outcome(await authorize(fx, "alice@acme.test"));
    expect(aliceAgain.codes).toContain("INVOCATION_LIMIT_REACHED");
  });

  it("refuses anyone the plan didn't name", async () => {
    const fx = await mk(twoRecipients);
    const eve = outcome(await authorize(fx, "eve@evil.test"));
    expect(eve.token).toBe(false);
    expect(eve.codes).toContain("CONSTRAINT_VIOLATION");
  });

  it("never issues a recipient's single use twice under a concurrent race", async () => {
    const fx = await mk(twoRecipients);
    const results = await Promise.all(Array.from({ length: 4 }, () => authorize(fx, "alice@acme.test")));
    expect(results.map(outcome).filter((o) => o.token)).toHaveLength(1);
  });

  it("leaves a single-action contract behaving exactly as before", async () => {
    const fx = await mk(JSON.stringify({ schemaVersion: 1, items: [emailTo("alice@acme.test")] }));
    expect(outcome(await authorize(fx, "alice@acme.test")).token).toBe(true);
    expect(outcome(await authorize(fx, "alice@acme.test")).codes).toContain("INVOCATION_LIMIT_REACHED");
    expect(outcome(await authorize(fx, "bob@acme.test")).codes).toContain("CONSTRAINT_VIOLATION");
  });
});
