import { describe, expect, it } from "vitest";

import { summarizeReasonCodes } from "@/lib/runtime/reason-codes";

describe("summarizeReasonCodes", () => {
  it("returns the known summary for a recognized first code", () => {
    expect(summarizeReasonCodes(["FORBIDDEN_RESOURCE", "WITHIN_CONTRACT"])).toBe(
      "The request touches a resource an active policy forbids outright.",
    );
  });

  it("falls back to the raw code for an unrecognized reason", () => {
    expect(summarizeReasonCodes(["SOME_FUTURE_CODE"])).toBe("SOME_FUTURE_CODE");
  });

  it("reports no reason when the list is empty", () => {
    expect(summarizeReasonCodes([])).toBe("No reason was recorded for this decision.");
  });

  it("covers every reason code authorize_tool_call() can emit", () => {
    const codes = [
      "TASK_NOT_EXECUTABLE",
      "NO_ACTIVE_CONTRACT",
      "CONTRACT_NOT_CURRENTLY_ACTIVE",
      "UNSUPPORTED_CONTRACT_VERSION",
      "FORBIDDEN_RESOURCE",
      "FORBIDDEN_OPERATION",
      "TOOL_NOT_IN_CONTRACT",
      "ARGUMENTS_UNDERSPECIFIED",
      "CONSTRAINT_VIOLATION",
      "INVOCATION_LIMIT_REACHED",
      "WITHIN_CONTRACT",
    ];
    for (const code of codes) {
      expect(summarizeReasonCodes([code])).not.toBe(code);
    }
  });
});
