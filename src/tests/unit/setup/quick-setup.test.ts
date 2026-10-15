import { describe, expect, it } from "vitest";

import { envFileText, exampleIntentFor, installCommand, quickstartSnippet } from "@/lib/setup/quick-setup";

describe("setup text", () => {
  it("writes the four env vars the snippet reads", () => {
    const text = envFileText({
      AUTHORITY_URL: "https://authority.example",
      AUTHORITY_BACKEND_API_KEY: "authority_dk_x",
      AUTHORITY_AGENT_ID: "agent-id",
      AUTHORITY_AGENT_RUNTIME_KEY: "authority_rk_y",
    });
    const snippet = quickstartSnippet("List channels");
    for (const name of [
      "AUTHORITY_URL",
      "AUTHORITY_BACKEND_API_KEY",
      "AUTHORITY_AGENT_ID",
      "AUTHORITY_AGENT_RUNTIME_KEY",
    ]) {
      expect(text).toContain(`${name}=`);
      expect(snippet).toContain(`process.env.${name}`);
    }
  });

  it("picks an example task for the first connector that has one", () => {
    expect(exampleIntentFor(["postgres_abc", "slack"])).toMatch(/Slack/);
    expect(exampleIntentFor([])).toMatch(/plain English/);
  });

  it("quotes the intent safely inside the snippet", () => {
    expect(quickstartSnippet('say "hi"')).toContain('intent: "say \\"hi\\""');
  });

  it("installs the SDK from this deployment", () => {
    expect(installCommand("https://authority.example")).toBe(
      "npm install https://authority.example/sdk/authority-sdk.tgz",
    );
  });
});
