import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import { MockSemanticRiskProvider } from "@/lib/semantic/mock-provider";
import { authorizeThroughGateway, type AuthorizeInput, type PipelineDeps } from "@/lib/gateway/pipeline";
import type { CommitResult, PrepareResult } from "@/lib/gateway/rpc";

const prepared = (over: Partial<PrepareResult> = {}): PrepareResult => ({
  status: "ok",
  mode: "shadow",
  provider: "mock",
  model: "mock-heuristic",
  timeoutMs: 500,
  required: false,
  enforceable: false,
  capabilityTtlSeconds: 60,
  taskIntent: "Read issue 1",
  allowedTools: ["github.get_issue"],
  priorCalls: [],
  detOutcome: "allow",
  alreadyDecided: false,
  ...over,
});

const committed = (over: Partial<CommitResult> = {}): CommitResult => ({
  status: "ok",
  replayed: false,
  decisionId: "d",
  finalDecisionId: "f",
  toolRequestId: "t",
  detOutcome: "allow",
  finalOutcome: "allow",
  reasonCodes: ["WITHIN_CONTRACT"],
  contractId: "c",
  contractVersion: 1,
  semanticMode: "shadow",
  semanticPolicy: "optional",
  degraded: false,
  degradedReason: null,
  narrowed: false,
  capabilityId: "cap",
  capabilityExpiresAt: "2026-01-01T00:01:00.000Z",
  capabilityMaxUses: 1,
  remainingInvocations: 5,
  ...over,
});

const input: AuthorizeInput = {
  credentialSecret: "authority_rk_secretsecretsecret",
  taskId: "00000000-0000-4000-8000-000000000001",
  tool: "github.get_issue",
  operation: "get_issue",
  arguments: { issue_number: "1", note: "RAW-VALUE ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6" },
  idempotencyKey: "k",
  registryVersion: "rv1",
  compilerVersion: "cv1",
};

function deps(over: Partial<PipelineDeps> & { p?: Partial<PrepareResult>; c?: Partial<CommitResult> } = {}) {
  const prepare = vi.fn().mockResolvedValue(prepared(over.p));
  const commit = vi.fn().mockResolvedValue(committed(over.c));
  const provider = vi.fn(() => new MockSemanticRiskProvider());
  const d: PipelineDeps = {
    prepare: prepare as never,
    commit: commit as never,
    createProvider: provider as never,
    breakerFor: () => new CircuitBreaker(),
    ...over,
  };
  return { d, prepare, commit, provider };
}

describe("authorizeThroughGateway", () => {
  it("orders the flow: prepare, then semantic evaluation, then one atomic commit", async () => {
    const order: string[] = [];
    const { d, prepare, commit, provider } = deps();
    prepare.mockImplementation(async () => (order.push("prepare"), prepared()));
    provider.mockImplementation((() => {
      order.push("provider");
      return new MockSemanticRiskProvider();
    }) as never);
    commit.mockImplementation(async () => (order.push("commit"), committed()));
    await authorizeThroughGateway(input, d);
    expect(order).toEqual(["prepare", "provider", "commit"]);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("stops on an authentication failure without evaluating or committing anything", async () => {
    const { d, commit, provider } = deps({ p: { status: "invalid_credential" } });
    const r = await authorizeThroughGateway(input, d);
    expect(r).toEqual({ kind: "failure", status: "invalid_credential" });
    expect(provider).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not call the provider when semantic mode is off", async () => {
    const { d, provider, commit } = deps({ p: { mode: "off" } });
    await authorizeThroughGateway(input, d);
    expect(provider).not.toHaveBeenCalled();
    expect(commit.mock.calls[0][0].evidence).toBeNull();
  });

  it("does not call the provider for a request that was already decided (replay)", async () => {
    const { d, provider } = deps({ p: { alreadyDecided: true } });
    await authorizeThroughGateway(input, d);
    expect(provider).not.toHaveBeenCalled();
  });

  it("passes the semantic evidence, never the raw arguments, into the evidence record", async () => {
    const { d, commit } = deps();
    await authorizeThroughGateway(input, d);
    const arg = commit.mock.calls[0][0];
    expect(arg.evidence).not.toBeNull();
    expect(JSON.stringify(arg.evidence)).not.toContain("RAW-VALUE");
    expect(JSON.stringify(arg.evidence)).not.toContain("ghp_");
    // The audit representation handed to the database carries no raw value either.
    expect(JSON.stringify(arg.argumentAudit)).not.toContain("RAW-VALUE");
    expect(JSON.stringify(arg.argumentAudit)).not.toContain("ghp_");
  });

  it("turns a provider failure into degraded evidence and still commits (the database decides what that means)", async () => {
    const { d, commit } = deps({
      createProvider: (() => new MockSemanticRiskProvider({ simulate: "error" })) as never,
    });
    const r = await authorizeThroughGateway(input, d);
    expect(r.kind).toBe("decision");
    expect(commit.mock.calls[0][0].evidence.state).toBe("error");
  });

  it("returns the plaintext token only for a capability issued by this call", async () => {
    const issued = await authorizeThroughGateway(input, deps().d);
    expect(issued.kind === "decision" && issued.capabilityToken).toMatch(/^authcap_v1_/);

    const replay = await authorizeThroughGateway(input, deps({ c: { replayed: true } }).d);
    expect(replay.kind === "decision" && replay.capabilityToken).toBeNull();

    const denied = await authorizeThroughGateway(
      input,
      deps({ c: { capabilityId: null, finalOutcome: "deny" } }).d,
    );
    expect(denied.kind === "decision" && denied.capabilityToken).toBeNull();
  });

  it("sends only the hash of the token to the database", async () => {
    const { d, commit } = deps();
    const r = await authorizeThroughGateway(input, d);
    const sentHash = commit.mock.calls[0][0].tokenHash as string;
    expect(sentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(commit.mock.calls[0])).not.toContain(
      r.kind === "decision" ? (r.capabilityToken as string) : "x",
    );
  });

  it("propagates a database-level failure status", async () => {
    const r = await authorizeThroughGateway(input, deps({ c: { status: "idempotency_conflict" } }).d);
    expect(r).toEqual({ kind: "failure", status: "idempotency_conflict" });
  });

  it("classifies risk from trusted registry data, not from the request", async () => {
    const low = deps();
    await authorizeThroughGateway(input, low.d);
    expect(low.commit.mock.calls[0][0].riskClass).toBe("low");
    const high = deps();
    await authorizeThroughGateway({ ...input, tool: "github.delete_branch" }, high.d);
    expect(high.commit.mock.calls[0][0].riskClass).toBe("high");
    const unknown = deps();
    await authorizeThroughGateway({ ...input, tool: "made.up_tool" }, unknown.d);
    expect(unknown.commit.mock.calls[0][0].riskClass).toBe("high");
  });

  it("defaults to single use and forwards an explicit bounded multi-use", async () => {
    const single = deps();
    await authorizeThroughGateway(input, single.d);
    expect(single.commit.mock.calls[0][0].maxUses).toBe(1);
    const multi = deps();
    await authorizeThroughGateway({ ...input, maxUses: 3 }, multi.d);
    expect(multi.commit.mock.calls[0][0].maxUses).toBe(3);
  });
});
