import { describe, expect, it } from "vitest";

import { REST_CONNECTOR_SPECS } from "@/lib/connectors/rest/providers";
import { sentry } from "@/lib/connectors/rest/providers/sentry";
import { zendesk } from "@/lib/connectors/rest/providers/zendesk";
import {
  configValues,
  operationFor,
  parseSpec,
  planRestRequest,
  planVerifyRequest,
  RestRequestError,
  validateArgs,
} from "@/lib/connectors/rest/request";
import type { ParsedRestConnectorSpec, RestOperationSpec } from "@/lib/connectors/rest/spec";

const SECRET = "test-secret-not-real-123";
const S = parseSpec(sentry);
const Z = parseSpec(zendesk);
const ZCONFIG = { subdomain: "acme", email: "agent@acme.test" };

function plan(
  spec: ParsedRestConnectorSpec,
  tool: string,
  args: unknown,
  config: Record<string, unknown> = {},
) {
  const op = operationFor(spec, tool);
  return planRestRequest(spec, op, validateArgs(op, args), { config, secret: SECRET });
}

describe("planRestRequest: exact requests", () => {
  it("builds Sentry's get_issue with a bearer token and the pinned ids percent-encoded in the path", () => {
    const r = plan(S, "sentry.get_issue", { organization_slug: "acme", issue_id: "42" });
    expect(r.method).toBe("GET");
    expect(r.url.toString()).toBe("https://sentry.io/api/0/organizations/acme/issues/42/");
    expect(r.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(r.body).toBeUndefined();
    expect(r.resource).toBe("42");
    expect(r.isWrite).toBe(false);
  });

  it("adds fixed query and body values the agent cannot change", () => {
    const list = plan(S, "sentry.list_issues", { organization_slug: "acme", project_slug: "web" });
    expect(list.url.searchParams.get("query")).toBe("is:unresolved");
    const resolve = plan(S, "sentry.resolve_issue", { organization_slug: "acme", issue_id: "42" });
    expect(resolve.method).toBe("PUT");
    expect(JSON.parse(resolve.body!)).toEqual({ status: "resolved" });
    expect(resolve.isWrite).toBe(true);
  });

  it("nests body args at their declared target and uses basic auth on the account's own subdomain", () => {
    const r = plan(Z, "zendesk.add_comment", { ticket_id: 7, body: "Thanks!", public: false }, ZCONFIG);
    expect(r.url.toString()).toBe("https://acme.zendesk.com/api/v2/tickets/7.json");
    expect(JSON.parse(r.body!)).toEqual({ ticket: { comment: { body: "Thanks!", public: false } } });
    expect(r.headers.authorization).toBe(
      `Basic ${Buffer.from(`agent@acme.test/token:${SECRET}`).toString("base64")}`,
    );
    expect(r.headers["content-type"]).toBe("application/json");
  });

  it("verifies with the spec's cheap read and the same auth", () => {
    const v = planVerifyRequest(Z, { config: ZCONFIG, secret: SECRET });
    expect(v.url.toString()).toBe("https://acme.zendesk.com/api/v2/users/me.json");
    expect(v.method).toBe("GET");
  });
});

describe("refusals", () => {
  it("refuses undeclared, missing and mistyped arguments", () => {
    const op = operationFor(S, "sentry.get_issue");
    expect(() => validateArgs(op, { organization_slug: "a", issue_id: "1", extra: "x" })).toThrow(
      RestRequestError,
    );
    expect(() => validateArgs(op, { organization_slug: "a" })).toThrow(/issue_id/);
    expect(() => validateArgs(op, { organization_slug: "a", issue_id: 1 })).toThrow(/string/);
    expect(() => validateArgs(op, { organization_slug: "", issue_id: "1" })).toThrow(/empty/);
    expect(() => validateArgs(op, ["a"])).toThrow(/object/);
  });

  it("refuses tools from another provider or not in the spec", () => {
    expect(() => operationFor(S, "zendesk.get_ticket")).toThrow();
    expect(() => operationFor(S, "sentry.delete_project")).toThrow();
  });

  it("keeps path values inside their segment (no traversal, no extra segments, no query smuggling)", () => {
    const r = plan(S, "sentry.get_issue", { organization_slug: "../../admin", issue_id: "1?x=1#f" });
    expect(r.url.pathname).toBe("/api/0/organizations/..%2F..%2Fadmin/issues/1%3Fx%3D1%23f/");
    expect(r.url.search).toBe("");
    expect(r.url.hostname).toBe("sentry.io");
    expect(() => plan(S, "sentry.get_issue", { organization_slug: "..", issue_id: "1" })).toThrow();
  });

  it("never lets a connection setting move the host or break a header", () => {
    for (const subdomain of ["evil.com#", "evil.com/x", "a.b", "a@b", "acme\r\nx: y", "ACME", ""]) {
      expect(() => configValues(Z, { ...ZCONFIG, subdomain }), subdomain).toThrow(/CONFIG_INVALID:subdomain/);
    }
    expect(() => configValues(Z, { ...ZCONFIG, email: "a@b.c\r\nx-evil: 1" })).toThrow(
      /CONFIG_INVALID:email/,
    );
    expect(() => configValues(Z, { subdomain: "acme" })).toThrow(/CONFIG_INVALID:email/);
  });

  it("refuses a secret containing a line break instead of sending a forged header", () => {
    const op = operationFor(S, "sentry.get_issue");
    expect(() =>
      planRestRequest(
        S,
        op,
        { organization_slug: "a", issue_id: "1" },
        { config: {}, secret: "x\r\nevil: 1" },
      ),
    ).toThrow(/CREDENTIAL_INVALID/);
  });
});

/** A value for a connection setting, from a small pool of shapes the shipped patterns use. */
function sampleConfig(spec: ParsedRestConnectorSpec): Record<string, string> | null {
  const pool = [
    "acme",
    "acme-co",
    "us21",
    `AC${"0".repeat(32)}`,
    "agent@acme.test",
    "12345",
    "1234567",
    "acme.myshopify.com",
    "abcdefgh",
    "ABCDEFGH12",
    "abcdef1234",
    "eu",
    "us",
    "app",
    "a1b2c3d4",
    "default",
    "0123456789abcdef0123456789abcdef",
    "01234567-89ab-4def-8123-456789abcdef",
    "mapi",
    "www",
  ];
  const out: Record<string, string> = {};
  for (const field of spec.configFields) {
    const hit = pool.find((v) => new RegExp(field.pattern).test(v));
    if (!hit) return null;
    out[field.key] = hit;
  }
  return out;
}

function sampleArgs(op: RestOperationSpec): Record<string, unknown> {
  return Object.fromEntries(
    op.args
      .filter((a) => a.required || a.in !== "path")
      .map((a) => [
        a.key,
        a.type === "number"
          ? 7
          : a.type === "boolean"
            ? true
            : a.type === "stringArray"
              ? ["v1"]
              : `v-${a.key}`,
      ]),
  );
}

describe.each(REST_CONNECTOR_SPECS.map((s) => [s.id, parseSpec(s)] as const))(
  "%s: every operation",
  (_id, spec) => {
    const config = sampleConfig(spec);
    it.skipIf(config === null).each(spec.operations.map((op) => [op.slug, op] as const))(
      "%s builds an https request to the spec's host, with the secret only in auth",
      (_slug, op) => {
        const args = sampleArgs(op);
        const r = planRestRequest(spec, op, validateArgs(op, args), { config: config!, secret: SECRET });
        const expectedHost = spec.host.replace(/\{config\.([a-z0-9_]+)\}/, (_m, k: string) => config![k]!);
        expect(r.url.protocol).toBe("https:");
        expect(r.url.hostname).toBe(expectedHost);
        expect(r.method).toBe(op.method);
        expect(r.isWrite).toBe(op.sideEffect !== "read");
        // The secret appears only where the auth block puts it.
        const authQuery = Object.keys(spec.auth.query ?? {});
        const pathAndOtherQuery = `${r.url.pathname}?${[...r.url.searchParams.entries()]
          .filter(([k]) => !authQuery.includes(k))
          .map(([k, v]) => `${k}=${v}`)
          .join("&")}`;
        expect(pathAndOtherQuery).not.toContain(SECRET);
        expect(r.body ?? "").not.toContain(SECRET);
        // Every argument value the agent supplied ends up somewhere in the request.
        for (const [key, value] of Object.entries(args)) {
          const shown = Array.isArray(value) ? String(value[0]) : String(value);
          const where = `${decodeURIComponent(r.url.toString())} ${r.body ?? ""}`;
          expect(where, key).toContain(shown);
        }
      },
    );
  },
);
