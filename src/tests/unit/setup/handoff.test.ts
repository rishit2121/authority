import { describe, expect, it } from "vitest";

import {
  connectionEnvVar,
  envBlock,
  firstCallSample,
  KEY_PLACEHOLDER,
  SAMPLE_RUN_COMMAND,
  setupPrompt,
} from "@/lib/setup/handoff";
import { READ_CALLS } from "@/lib/setup/state";

const BASE = "https://authority.example";
const CONNECTION = "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ENV = {
  AUTHORITY_URL: BASE,
  AUTHORITY_BACKEND_API_KEY: "authority_dk_live_backend_secret_value_123",
  AUTHORITY_AGENT_ID: "agent-7c1e0b9a-secret-agent-id",
  AUTHORITY_AGENT_RUNTIME_KEY: "authority_rk_live_runtime_secret_value_456",
};
const SECRET_VALUES = [
  ENV.AUTHORITY_BACKEND_API_KEY,
  ENV.AUTHORITY_AGENT_RUNTIME_KEY,
  ENV.AUTHORITY_AGENT_ID,
];

describe("envBlock", () => {
  it("holds the four keys and the chosen connection id when they were just issued", () => {
    const text = envBlock({ baseUrl: BASE, connectorId: "gmail", connectionId: CONNECTION, env: ENV });
    expect(text).toContain(`AUTHORITY_BACKEND_API_KEY=${ENV.AUTHORITY_BACKEND_API_KEY}`);
    expect(text).toContain(`AUTHORITY_AGENT_RUNTIME_KEY=${ENV.AUTHORITY_AGENT_RUNTIME_KEY}`);
    expect(text).toContain(`AUTHORITY_AGENT_ID=${ENV.AUTHORITY_AGENT_ID}`);
    expect(text.trim().split("\n").at(-1)).toBe(`GMAIL_CONNECTION_ID=${CONNECTION}`);
  });

  it("shows placeholders, never stale keys, when nothing was issued on this page view", () => {
    const text = envBlock({ baseUrl: BASE, connectorId: "slack", connectionId: CONNECTION });
    expect(text).toContain(`AUTHORITY_URL=${BASE}`);
    expect(text).toContain(`AUTHORITY_BACKEND_API_KEY=${KEY_PLACEHOLDER}`);
    expect(text).toContain(`AUTHORITY_AGENT_RUNTIME_KEY=${KEY_PLACEHOLDER}`);
    expect(text).toContain(`SLACK_CONNECTION_ID=${CONNECTION}`);
    expect(text).not.toMatch(/authority_(dk|rk|ts)_/);
  });

  it("names other connectors' connection variable", () => {
    expect(connectionEnvVar("notion")).toBe("NOTION_CONNECTION_ID");
    expect(connectionEnvVar("custom_ab12")).toBe("CUSTOM_AB12_CONNECTION_ID");
  });
});

describe.each([
  ["gmail", READ_CALLS.gmail],
  ["slack", READ_CALLS.slack],
] as const)("%s hand-off", (connectorId, call) => {
  const context = { baseUrl: BASE, call, connectionId: CONNECTION, env: ENV };
  const sample = firstCallSample(context);
  const prompt = setupPrompt(context);

  it("never contains a key, a key prefix or any value passed in", () => {
    for (const text of [sample, prompt]) {
      expect(text).not.toMatch(/authority_(dk|rk|ts)_/);
      for (const value of SECRET_VALUES) expect(text).not.toContain(value);
    }
  });

  it("the sample uses the SDK facade, specialized to this connector and its read tool", () => {
    expect(sample).toContain('import { Authority } from "@authority/sdk";');
    expect(sample).toContain("new Authority({");
    for (const name of [
      "AUTHORITY_URL",
      "AUTHORITY_BACKEND_API_KEY",
      "AUTHORITY_AGENT_ID",
      "AUTHORITY_AGENT_RUNTIME_KEY",
    ]) {
      expect(sample).toContain(`process.env.${name}`);
    }
    expect(sample).toContain(`connections: { ${connectorId}: process.env.${call.envVar} }`);
    expect(sample).toContain(
      `actions: [{ tool: "${call.tool}", expectedSideEffect: "read", maxInvocations: 1 }]`,
    );
    expect(sample).toContain(`run.task.call("${call.tool}", {}, { idempotencyKey: "first-call-1" })`);
    expect(sample).toContain('run.status !== "ready"');
    for (const status of ["executed", "result_held", "indeterminate"])
      expect(sample).toContain(`"${status}"`);
    // The other connector's tool never leaks in.
    const other = connectorId === "gmail" ? READ_CALLS.slack : READ_CALLS.gmail;
    expect(sample).not.toContain(other.tool);
    expect(sample).not.toContain(other.envVar);
  });

  it("the sample is plain JavaScript with the developer's own user id, not the setup customer", () => {
    expect(sample).not.toContain("authority-setup-");
    expect(sample).toMatch(/Use your own app's stable id/);
    expect(sample).not.toMatch(/: (string|number|boolean)\b|\bas const\b|\binterface\b|!\./);
    expect(sample).toContain(SAMPLE_RUN_COMMAND);
    expect(sample).not.toContain(CONNECTION);
  });

  it("the prompt explains goal, variable names, install, shape, rules and docs", () => {
    expect(prompt).toMatch(/^Goal: /);
    for (const name of [
      "AUTHORITY_URL",
      "AUTHORITY_BACKEND_API_KEY",
      "AUTHORITY_AGENT_ID",
      "AUTHORITY_AGENT_RUNTIME_KEY",
      call.envVar,
    ]) {
      expect(prompt).toContain(`- ${name}`);
    }
    expect(prompt).toContain(`npm install ${BASE}/sdk/authority-sdk.tgz`);
    expect(prompt).toContain("authority.prepareTask");
    expect(prompt).toContain(`run.task.call("${call.tool}"`);
    expect(prompt).toMatch(/Server-side only/);
    expect(prompt).toMatch(/browser/);
    expect(prompt).toMatch(/model\/tool arguments/);
    expect(prompt).toMatch(/idempotency keys from my own event/);
    expect(prompt).toMatch(/Never auto-retry "indeterminate"/);
    expect(prompt).toContain("`arguments`");
    expect(prompt).toContain("`agentGenerated`");
    expect(prompt).toContain(`${BASE}/docs/quickstart`);
    // The connection id is the only id it carries.
    expect(prompt).toContain(CONNECTION);
    expect(prompt.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)).toEqual([
      CONNECTION,
    ]);
  });
});
