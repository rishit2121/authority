import { describe, expect, it } from "vitest";

import { withoutEmptyResourceBindings } from "@/lib/gateway/prepare-task";

describe("withoutEmptyResourceBindings", () => {
  it("drops only empty bindings, leaving every other field and real bindings untouched", () => {
    const plan = {
      schemaVersion: 1,
      taskId: "t",
      nodes: [
        { id: "a", tool: "gmail.list_labels", resourceBinding: "" },
        { id: "b", tool: "slack.post_message", resourceBinding: "C-eng" },
      ],
    };
    expect(withoutEmptyResourceBindings(plan)).toEqual({
      schemaVersion: 1,
      taskId: "t",
      nodes: [
        { id: "a", tool: "gmail.list_labels" },
        { id: "b", tool: "slack.post_message", resourceBinding: "C-eng" },
      ],
    });
  });

  it("passes anything that isn't a plan through unchanged, for the schema to reject", () => {
    expect(withoutEmptyResourceBindings(null)).toBeNull();
    expect(withoutEmptyResourceBindings({ nodes: "x" })).toEqual({ nodes: "x" });
  });
});
