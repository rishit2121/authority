import { describe, expect, it } from "vitest";

import { githubDemoRegistry, loadRegistry } from "@/lib/registry";
import {
  autoRunnableReadTools,
  envFileText,
  exampleIntentFor,
  installCommand,
  quickstartSnippet,
} from "@/lib/setup/quick-setup";

const operations = [...loadRegistry(githubDemoRegistry).operations.values()];

describe("autoRunnableReadTools", () => {
  it("allow-lists only plain reads, and only for the selected connectors", () => {
    expect(autoRunnableReadTools(operations, ["slack"])).toEqual(["slack.list_channels"]);
    expect(autoRunnableReadTools(operations, ["linear", "notion"])).toEqual([
      "linear.get_issue",
      "linear.list_issues",
      "notion.query_database",
      "notion.retrieve_page",
    ]);
  });

  it("never auto-runs a write, a send, a payment, or anything secret-classified", () => {
    const every = autoRunnableReadTools(operations, [
      "github",
      "gmail",
      "slack",
      "stripe",
      "linear",
      "notion",
    ]);
    const byId = new Map(operations.map((op) => [op.id, op]));
    for (const tool of every) {
      const op = byId.get(tool)!;
      expect(op.sideEffect).toBe("read");
      expect(op.externalCommunication).toBe(false);
      expect(op.financialImpact).toBe(false);
      expect(op.dataSensitivity).not.toBe("secret");
    }
    expect(every).not.toContain("slack.post_message");
    expect(every).not.toContain("gmail.send_email");
    expect(every).not.toContain("stripe.issue_refund");
    expect(every).not.toContain("github.get_repository_secrets");
  });

  it("returns nothing when no connector is selected", () => {
    expect(autoRunnableReadTools(operations, [])).toEqual([]);
  });
});

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
