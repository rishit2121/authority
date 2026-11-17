import { describe, expect, it } from "vitest";

import { envFileText, installCommand } from "@/lib/setup/quick-setup";

describe("setup text", () => {
  it("writes the four env vars the hand-off code reads", () => {
    const text = envFileText({
      AUTHORITY_URL: "https://authority.example",
      AUTHORITY_BACKEND_API_KEY: "authority_dk_x",
      AUTHORITY_AGENT_ID: "agent-id",
      AUTHORITY_AGENT_RUNTIME_KEY: "authority_rk_y",
    });
    expect(text).toBe(
      [
        "AUTHORITY_URL=https://authority.example",
        "AUTHORITY_BACKEND_API_KEY=authority_dk_x",
        "AUTHORITY_AGENT_ID=agent-id",
        "AUTHORITY_AGENT_RUNTIME_KEY=authority_rk_y",
        "",
      ].join("\n"),
    );
  });

  it("installs the SDK from this deployment", () => {
    expect(installCommand("https://authority.example")).toBe(
      "npm install https://authority.example/sdk/authority-sdk.tgz",
    );
  });
});
