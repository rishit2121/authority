import { describe, expect, it } from "vitest";

import { EnvironmentError, parseSupabaseEnv, SUPABASE_ENV_KEYS } from "@/lib/env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdefghij",
};

describe("parseSupabaseEnv", () => {
  it("accepts a valid publishable configuration", () => {
    expect(parseSupabaseEnv(VALID)).toEqual({
      url: VALID.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
  });

  it("strips a trailing slash so URL joining stays predictable", () => {
    expect(
      parseSupabaseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: `${VALID.NEXT_PUBLIC_SUPABASE_URL}/` }).url,
    ).toBe(VALID.NEXT_PUBLIC_SUPABASE_URL);
  });

  it("trims surrounding whitespace from a pasted value", () => {
    expect(
      parseSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: `  ${VALID.NEXT_PUBLIC_SUPABASE_URL}  `,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `  ${VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}\n`,
      }).publishableKey,
    ).toBe(VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  });

  describe("legacy anon key fallback", () => {
    it("accepts a legacy anon key when no publishable key is set", () => {
      const legacy = `eyJ${"a".repeat(60)}`;
      expect(
        parseSupabaseEnv({
          NEXT_PUBLIC_SUPABASE_URL: VALID.NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: legacy,
        }).publishableKey,
      ).toBe(legacy);
    });

    it("prefers the publishable key when both are present", () => {
      expect(
        parseSupabaseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_ANON_KEY: `eyJ${"a".repeat(60)}` }).publishableKey,
      ).toBe(VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    });
  });

  describe("rejects misconfiguration", () => {
    it("throws when the URL is absent", () => {
      expect(() =>
        parseSupabaseEnv({
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        }),
      ).toThrow(EnvironmentError);
    });

    it("throws when no key of either name is present", () => {
      expect(() => parseSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: VALID.NEXT_PUBLIC_SUPABASE_URL })).toThrow(
        EnvironmentError,
      );
    });

    it("rejects a non-https URL, since Supabase is always https", () => {
      expect(() =>
        parseSupabaseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }),
      ).toThrow(EnvironmentError);
    });

    it("rejects a value that is not a URL at all", () => {
      expect(() => parseSupabaseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).toThrow(
        EnvironmentError,
      );
    });

    it("rejects a truncated key", () => {
      expect(() =>
        parseSupabaseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish" }),
      ).toThrow(EnvironmentError);
    });

    it("treats an empty string as absent rather than as a value", () => {
      expect(() => parseSupabaseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "" })).toThrow(EnvironmentError);
    });
  });

  describe("error reporting", () => {
    it("names the missing variables and mentions the legacy fallback", () => {
      try {
        parseSupabaseEnv({});
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvironmentError);
        const message = (error as EnvironmentError).message;
        for (const key of SUPABASE_ENV_KEYS) expect(message).toContain(key);
        expect(message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
        expect(message).toContain(".env.example");
        expect((error as EnvironmentError).missing).toContain("NEXT_PUBLIC_SUPABASE_URL");
      }
    });

    // A config error is frequently the thing that ends up in a CI log or a
    // screenshot, so it must not carry the value it rejected.
    it("never includes the offending value in the message", () => {
      const secretish = "sb_publishable_THIS_MUST_NOT_APPEAR_IN_OUTPUT";
      try {
        parseSupabaseEnv({
          NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secretish,
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect((error as EnvironmentError).message).not.toContain(secretish);
        expect((error as EnvironmentError).message).not.toContain("not-a-url");
      }
    });
  });
});
