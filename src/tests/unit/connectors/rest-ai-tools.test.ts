import { describe, expect, it } from "vitest";

import { offeredToAiPlanner } from "@/lib/connectors/rest/ai-tools";

describe("AI plan generation is offered an API-key connector only when the request names it", () => {
  it("always offers hand-written connectors and tenant operations", () => {
    expect(offeredToAiPlanner("slack", "anything")).toBe(true);
    expect(offeredToAiPlanner("custom_ab12cd34", "anything")).toBe(true);
  });

  it("offers Sentry and Zendesk only when named", () => {
    expect(offeredToAiPlanner("sentry", "Resolve the Sentry issue 42 in acme")).toBe(true);
    expect(offeredToAiPlanner("sentry", "Post the release notes to #engineering")).toBe(false);
    expect(offeredToAiPlanner("zendesk", "reply on zendesk ticket 7")).toBe(true);
    expect(offeredToAiPlanner("zendesk", "Summarize our sentry issues")).toBe(false);
  });
});
