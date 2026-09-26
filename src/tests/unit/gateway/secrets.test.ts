import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OpenAiCompatibleSemanticProvider,
  getSemanticProviderEnv,
} from "@/lib/semantic/openai-compatible-provider";
import { runSemanticEvaluation } from "@/lib/semantic/runner";
import { scrubKnownSecrets, safeLog } from "@/lib/semantic/scrub";
import {
  GatewayDatabaseError,
  GatewayNotConfiguredError,
  closeGatewayPool,
  gatewayQuery,
} from "@/lib/gateway/db";
import { providerEnforcementGrade } from "@/lib/semantic/enforcement-grade";

const PROVIDER_KEY = "sk-provider-key-DO-NOT-LEAK-1234567890";
const SECOND_KEY = "sk-second-key-DO-NOT-LEAK-0987654321";
const DB_PASSWORD = "gatewaypassword0123456789abcdef";
const DB_URL = `postgresql://authority_gateway.ref:${DB_PASSWORD}@pooler.example:6543/postgres`;
const input = {
  taskIntent: "Read issue 1",
  tool: "github.get_issue",
  operation: "get_issue",
  resource: null,
  arguments: { issue_number: "1" },
  contractAllowedTools: ["github.get_issue"],
  priorCalls: [],
};

let logged: string[];
beforeEach(() => {
  logged = [];
  for (const m of ["error", "warn", "log", "info"] as const) {
    vi.spyOn(console, m).mockImplementation(
      (...args: unknown[]) => void logged.push(args.map(String).join(" ")),
    );
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeGatewayPool();
  delete process.env.GATEWAY_DATABASE_URL;
  delete process.env.SEMANTIC_PROVIDER_API_KEY;
});

describe("scrubKnownSecrets", () => {
  it("removes every configured secret value, including the database password inside a URL", () => {
    const env = {
      SEMANTIC_PROVIDER_API_KEY: PROVIDER_KEY,
      SEMANTIC_PROVIDER_API_KEY_SECONDARY: SECOND_KEY,
      GATEWAY_DATABASE_URL: DB_URL,
    };
    const text = `a ${PROVIDER_KEY} b ${SECOND_KEY} c ${DB_URL} d ${DB_PASSWORD}`;
    const out = scrubKnownSecrets(text, env);
    for (const s of [PROVIDER_KEY, SECOND_KEY, DB_PASSWORD, DB_URL]) expect(out).not.toContain(s);
    expect(out).toContain("[REDACTED]");
  });
  it("removes runtime keys, capability tokens and bearer material regardless of configuration", () => {
    const out = scrubKnownSecrets(
      `k authority_rk_${"a1".repeat(32)} c authcap_v1_${"B".repeat(43)} Authorization: Bearer abcdefghijklmnop123`,
      {},
    );
    expect(out).not.toMatch(/authority_rk_[0-9a-f]{16}|authcap_v1_|abcdefghijklmnop/);
  });
  it("leaves ordinary text alone", () =>
    expect(scrubKnownSecrets("nothing secret here", {})).toBe("nothing secret here"));
  it("safeLog scrubs before writing", () => {
    process.env.SEMANTIC_PROVIDER_API_KEY = PROVIDER_KEY;
    safeLog(`failure with ${PROVIDER_KEY}`);
    expect(logged.join(" ")).not.toContain(PROVIDER_KEY);
  });
});

describe("provider credentials never surface", () => {
  it("does not appear in evidence, errors or logs across every provider failure mode", async () => {
    const env = { apiKeys: [PROVIDER_KEY], baseUrl: "https://llm.example/v1" };
    const cases: (() => Promise<Response>)[] = [
      async () => new Response(`upstream said ${PROVIDER_KEY}`, { status: 500 }),
      async () => new Response(`not json ${PROVIDER_KEY}`),
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: `oops ${PROVIDER_KEY}` } }] })),
      async () => {
        throw new TypeError(`connect failed for ${PROVIDER_KEY}`);
      },
    ];
    for (const make of cases) {
      const provider = new OpenAiCompatibleSemanticProvider("m", env, vi.fn(make) as never);
      const { evidence } = await runSemanticEvaluation({ provider, input });
      const dump = JSON.stringify(evidence);
      expect(dump).not.toContain(PROVIDER_KEY);
      expect(evidence.state).not.toBe("ok");
    }
    expect(logged.join(" ")).not.toContain(PROVIDER_KEY);
  });

  it("is sent only in the Authorization header and never inside the request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    await runSemanticEvaluation({
      provider: new OpenAiCompatibleSemanticProvider(
        "m",
        { apiKeys: [PROVIDER_KEY], baseUrl: "https://llm.example/v1" },
        fetchImpl as never,
      ),
      input,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).not.toContain(PROVIDER_KEY);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${PROVIDER_KEY}`);
  });
});

describe("provider key rotation", () => {
  const ok = () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                signals: {
                  taskAlignment: 0.9,
                  resourceRelevance: 0.9,
                  scopeExpansion: 0.1,
                  externalDisclosure: 0.1,
                  promptInjection: 0.1,
                  suspiciousArgumentChange: 0.1,
                  planDeviation: 0.1,
                },
                indicators: [],
                confidence: 0.8,
              }),
            },
          },
        ],
      }),
    );

  it("reads a secondary key only alongside a distinct primary", () => {
    expect(
      getSemanticProviderEnv({ SEMANTIC_PROVIDER_API_KEY: "a", SEMANTIC_PROVIDER_API_KEY_SECONDARY: "b" })
        ?.apiKeys,
    ).toEqual(["a", "b"]);
    expect(
      getSemanticProviderEnv({ SEMANTIC_PROVIDER_API_KEY: "a", SEMANTIC_PROVIDER_API_KEY_SECONDARY: "a" })
        ?.apiKeys,
    ).toEqual(["a"]);
    expect(getSemanticProviderEnv({ SEMANTIC_PROVIDER_API_KEY_SECONDARY: "b" })).toBeNull();
  });

  it("falls back to the secondary key only when the primary is rejected as unauthorized", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("no", { status: 401 }))
      .mockResolvedValueOnce(ok());
    const provider = new OpenAiCompatibleSemanticProvider(
      "m",
      { apiKeys: ["primary-key-000", "secondary-key-111"], baseUrl: "https://llm.example/v1" },
      fetchImpl as never,
    );
    const { evidence } = await runSemanticEvaluation({ provider, input });
    expect(evidence.state).toBe("ok");
    expect((fetchImpl.mock.calls[1][1].headers as Record<string, string>).authorization).toBe(
      "Bearer secondary-key-111",
    );
  });

  it("does not try the secondary key after a non-auth failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const provider = new OpenAiCompatibleSemanticProvider(
      "m",
      { apiKeys: ["primary-key-000", "secondary-key-111"], baseUrl: "https://llm.example/v1" },
      fetchImpl as never,
    );
    await runSemanticEvaluation({ provider, input });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("gateway database module", () => {
  it("throws a not-configured error without any credential", async () => {
    delete process.env.GATEWAY_DATABASE_URL;
    await expect(gatewayQuery("select 1")).rejects.toBeInstanceOf(GatewayNotConfiguredError);
  });

  it("surfaces only a SQLSTATE on failure — never the URL, password, statement or parameters", async () => {
    process.env.GATEWAY_DATABASE_URL = DB_URL;
    await expect(gatewayQuery("select $1", ["RAW-PARAMETER-VALUE"])).rejects.toBeInstanceOf(
      GatewayDatabaseError,
    );
    const error = await gatewayQuery("select $1", ["RAW-PARAMETER-VALUE"]).catch((e) => e as Error);
    const everything = `${(error as Error).message} ${JSON.stringify(error)} ${logged.join(" ")}`;
    expect(everything).not.toContain(DB_PASSWORD);
    expect(everything).not.toContain("pooler.example");
    expect(everything).not.toContain("RAW-PARAMETER-VALUE");
    expect(everything).toMatch(/sqlstate/);
  }, 20_000);

  it("rejects an unparseable URL as not configured", async () => {
    process.env.GATEWAY_DATABASE_URL = "not a url";
    await expect(gatewayQuery("select 1")).rejects.toBeInstanceOf(GatewayNotConfiguredError);
  });
});

describe("providerEnforcementGrade (mirrors gateway.provider_enforcement_grade)", () => {
  it.each([
    ["mock", "development", true],
    ["mock", "staging", false],
    ["mock", "production", false],
    ["legacy_lexical", "development", true],
    ["legacy_lexical", "production", false],
    ["openai_compatible", "development", true],
    ["openai_compatible", "production", true],
    ["unknown", "development", false],
  ] as const)("%s in %s -> %s", (provider, env, expected) => {
    expect(providerEnforcementGrade(provider, env)).toBe(expected);
  });
});
