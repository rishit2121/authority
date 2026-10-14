import { describe, expect, it } from "vitest";

import { isPlatformAdmin } from "@/lib/auth/platform-admin";

describe("isPlatformAdmin", () => {
  const env = {
    PLATFORM_ADMIN_EMAILS: " Ops@Example.com, second@example.com ,,",
  } as unknown as NodeJS.ProcessEnv;

  it("matches listed emails, ignoring case and whitespace", () => {
    expect(isPlatformAdmin("ops@example.com", env)).toBe(true);
    expect(isPlatformAdmin(" SECOND@example.com ", env)).toBe(true);
  });

  it("denies everyone else, and everyone when unset", () => {
    expect(isPlatformAdmin("someone@example.com", env)).toBe(false);
    expect(isPlatformAdmin("", env)).toBe(false);
    expect(isPlatformAdmin(null, env)).toBe(false);
    expect(isPlatformAdmin("ops@example.com", {} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("never treats a partial match as a match", () => {
    expect(isPlatformAdmin("ops@example.co", env)).toBe(false);
    expect(isPlatformAdmin("xops@example.com", env)).toBe(false);
  });
});
