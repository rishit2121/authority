import { describe, expect, it, vi } from "vitest";

import { authorizeToolCall, AuthorizeToolCallError } from "@/lib/runtime/authorize-tool-call";

function mockSupabase(result: { data?: unknown; error?: { code?: string; message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  } as never;
}

const BASE_INPUT = {
  credentialSecret: "authority_rk_test",
  taskId: "task-1",
  tool: "github.get_issue",
  operation: "get_issue",
  idempotencyKey: "idem-1",
  currentRegistryVersion: "rv1",
  currentCompilerVersion: "cv1",
};

describe("authorizeToolCall", () => {
  it("maps a successful row to a typed result", async () => {
    const supabase = mockSupabase({
      data: [
        {
          decision_id: "d1",
          tool_request_id: "tr1",
          outcome: "allow",
          reason_codes: ["WITHIN_CONTRACT"],
          contract_id: "c1",
          contract_version: 1,
          remaining_invocations: 4,
          was_replayed: false,
        },
      ],
    });

    const result = await authorizeToolCall(supabase, BASE_INPUT);
    expect(result).toEqual({
      decisionId: "d1",
      toolRequestId: "tr1",
      outcome: "allow",
      reasonCodes: ["WITHIN_CONTRACT"],
      contractId: "c1",
      contractVersion: 1,
      remainingInvocations: 4,
      wasReplayed: false,
    });
  });

  it("treats a null contract_id/contract_version/remaining_invocations as genuinely absent", async () => {
    const supabase = mockSupabase({
      data: [
        {
          decision_id: "d1",
          tool_request_id: "tr1",
          outcome: "deny",
          reason_codes: ["NO_ACTIVE_CONTRACT"],
          contract_id: null,
          contract_version: null,
          remaining_invocations: null,
          was_replayed: false,
        },
      ],
    });

    const result = await authorizeToolCall(supabase, BASE_INPUT);
    expect(result.contractId).toBeNull();
    expect(result.contractVersion).toBeNull();
    expect(result.remainingInvocations).toBeNull();
  });

  it.each([
    ["28000", "invalid_credential"],
    ["42501", "forbidden"],
    ["P0002", "not_found"],
    ["23505", "idempotency_conflict"],
    ["53400", "rate_limited"],
    ["22023", "invalid_request"],
    ["99999", "unknown"],
  ] as const)("maps SQLSTATE %s to failure reason %s", async (code, reason) => {
    const supabase = mockSupabase({ error: { code, message: "boom" } });

    await expect(authorizeToolCall(supabase, BASE_INPUT)).rejects.toMatchObject(
      new AuthorizeToolCallError(reason, "boom"),
    );
  });

  it("throws unknown when the RPC returns no row at all", async () => {
    const supabase = mockSupabase({ data: [] });
    await expect(authorizeToolCall(supabase, BASE_INPUT)).rejects.toThrow(AuthorizeToolCallError);
  });
});
