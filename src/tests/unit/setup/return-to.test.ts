import { describe, expect, it } from "vitest";

import { safeReturnTo, sameOriginUrl, withQueryParam } from "@/lib/setup/return-to";

const APP = "3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";

describe("safeReturnTo", () => {
  it("accepts the Setup page and its query string", () => {
    expect(safeReturnTo("/app/setup")).toBe("/app/setup");
    expect(safeReturnTo(`/app/setup?app=${APP}`)).toBe(`/app/setup?app=${APP}`);
    expect(safeReturnTo(`/app/setup?app=${APP}&connection=${APP}`)).toBe(
      `/app/setup?app=${APP}&connection=${APP}`,
    );
    expect(safeReturnTo("/app/setup/anything")).toBe("/app/setup/anything");
  });

  it("drops a fragment", () => {
    expect(safeReturnTo("/app/setup?app=1#step-2")).toBe("/app/setup?app=1");
  });

  it.each([
    ["protocol-relative", "//evil.example/app/setup"],
    ["protocol-relative with path", "//evil.example"],
    ["absolute https", "https://evil.example/app/setup"],
    ["absolute http to self-looking host", "http://localhost/app/setup"],
    ["javascript scheme", "javascript:alert(1)"],
    ["a different page", "/app/integrations/gmail"],
    ["a prefix lookalike", "/app/setupx"],
    ["a prefix lookalike with query", "/app/setup-evil?x=1"],
    ["relative path", "app/setup"],
    ["backslash host", "/\\evil.example"],
    ["backslash inside", "/app/setup\\..\\..\\evil"],
    ["encoded slash", "/app/setup%2F..%2F..%2Fevil"],
    ["encoded backslash", "/app/setup%5Cevil"],
    ["encoded dot segments", "/app/setup/%2e%2e/%2e%2e/admin"],
    ["double-encoded slash start", "/%2F%2Fevil.example"],
    ["dot segments", "/app/setup/../../admin"],
    ["single dot segment", "/app/./setup"],
    ["tab", "/app/setup\t"],
    ["newline", "/app/setup\n//evil"],
    ["space", "/app/setup ?x"],
    ["null byte encoded", "/app/setup%00"],
    ["empty", ""],
  ])("rejects %s", (_name, value) => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it("rejects non-strings and overlong values", () => {
    expect(safeReturnTo(undefined)).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(42)).toBeNull();
    expect(safeReturnTo(["/app/setup"])).toBeNull();
    expect(safeReturnTo(`/app/setup?x=${"a".repeat(2000)}`)).toBeNull();
  });
});

describe("withQueryParam", () => {
  it("adds or replaces one parameter", () => {
    expect(withQueryParam("/app/setup", "connected", "gmail")).toBe("/app/setup?connected=gmail");
    expect(withQueryParam(`/app/setup?app=${APP}&connected=x`, "connected", "gmail")).toBe(
      `/app/setup?app=${APP}&connected=gmail`,
    );
    expect(withQueryParam("/app/setup", "connect_error", "a b&c")).toBe("/app/setup?connect_error=a+b%26c");
  });
});

describe("sameOriginUrl", () => {
  it("keeps a same-origin path and falls back for anything else", () => {
    expect(sameOriginUrl("/app/setup?app=1", "https://authority.example", "/fallback").href).toBe(
      "https://authority.example/app/setup?app=1",
    );
    expect(sameOriginUrl("//evil.example/x", "https://authority.example", "/fallback").href).toBe(
      "https://authority.example/fallback",
    );
    expect(sameOriginUrl("https://evil.example/", "https://authority.example", "/fallback").href).toBe(
      "https://authority.example/fallback",
    );
  });
});
