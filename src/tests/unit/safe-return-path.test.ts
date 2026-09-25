import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTHENTICATED_PATH,
  loginUrlFor,
  RETURN_PATH_PARAM,
  safeReturnPath,
} from "@/lib/auth/redirect";

describe("safeReturnPath", () => {
  it("accepts internal absolute paths", () => {
    expect(safeReturnPath("/app")).toBe("/app");
    expect(safeReturnPath("/app/tasks/demo-task")).toBe("/app/tasks/demo-task");
  });

  it("preserves query and fragment on an internal path", () => {
    expect(safeReturnPath("/app/tasks?status=executing")).toBe("/app/tasks?status=executing");
    expect(safeReturnPath("/app/tasks#timeline")).toBe("/app/tasks#timeline");
  });

  it("falls back when there is no candidate", () => {
    expect(safeReturnPath(null)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safeReturnPath(undefined)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safeReturnPath("")).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(safeReturnPath("   ")).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  // The whole point of the helper: none of these may ever be returned.
  describe("rejects external destinations", () => {
    const hostile = [
      "https://evil.example/app",
      "http://evil.example",
      "//evil.example",
      "//evil.example/app",
      "/\\evil.example",
      "/\\/evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:someone@evil.example",
      "app/tasks",
      "../../etc/passwd",
      "/%2fevil.example",
      "/%5cevil.example",
      // Uppercase encodings are the same bytes; a case-sensitive check here
      // was a real hole.
      "/%2Fevil.example",
      "/%5Cevil.example",
      "/%5CEVIL.example",
      "https:/evil.example",
      "/app\\..\\..\\evil",
    ];

    for (const candidate of hostile) {
      it(`rejects ${JSON.stringify(candidate)}`, () => {
        expect(safeReturnPath(candidate)).toBe(DEFAULT_AUTHENTICATED_PATH);
      });
    }
  });

  describe("rejects smuggled control characters", () => {
    const hostile = [
      "/app\nSet-Cookie: a=b",
      "/app\r\nLocation: https://evil.example",
      "/app\tnext",
      "/app%0d%0aSet-Cookie:%20a=b",
      "/app%00",
      "/app%09",
    ];

    for (const candidate of hostile) {
      it(`rejects ${JSON.stringify(candidate)}`, () => {
        expect(safeReturnPath(candidate)).toBe(DEFAULT_AUTHENTICATED_PATH);
      });
    }
  });

  it("refuses auth routes as destinations", () => {
    for (const candidate of [
      "/login",
      "/login?next=/app",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/auth/callback",
      "/auth/sign-out",
      "/LOGIN",
    ]) {
      expect(safeReturnPath(candidate)).toBe(DEFAULT_AUTHENTICATED_PATH);
    }
  });

  it("does not mistake a path that merely starts with an auth-route name", () => {
    expect(safeReturnPath("/loginary")).toBe("/loginary");
    expect(safeReturnPath("/app/login")).toBe("/app/login");
  });

  it("rejects an over-long candidate rather than truncating it", () => {
    expect(safeReturnPath(`/app/${"a".repeat(2000)}`)).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  it("honours an explicit fallback", () => {
    expect(safeReturnPath("https://evil.example", "/somewhere")).toBe("/somewhere");
  });
});

describe("loginUrlFor", () => {
  it("encodes a safe target into the next parameter", () => {
    expect(loginUrlFor("/app/tasks")).toBe(`/login?${RETURN_PATH_PARAM}=%2Fapp%2Ftasks`);
  });

  it("preserves a query string in the encoded target", () => {
    const url = loginUrlFor("/app/tasks?status=executing");
    expect(url).toBe(`/login?${RETURN_PATH_PARAM}=%2Fapp%2Ftasks%3Fstatus%3Dexecuting`);
    // Round-trips back to the original path.
    const next = new URL(url, "https://authority.invalid").searchParams.get(RETURN_PATH_PARAM);
    expect(safeReturnPath(next)).toBe("/app/tasks?status=executing");
  });

  it("drops a hostile target instead of propagating it", () => {
    expect(loginUrlFor("https://evil.example")).toBe("/login");
    expect(loginUrlFor("//evil.example")).toBe("/login");
  });

  it("does not loop back to an auth route", () => {
    expect(loginUrlFor("/login")).toBe("/login");
  });
});
