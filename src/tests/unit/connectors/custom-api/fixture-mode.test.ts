import { describe, expect, it } from "vitest";

import { customApiFixtureModeEnabled } from "@/lib/connectors/custom-api/fixture-mode";

describe("customApiFixtureModeEnabled", () => {
  it("is off by default", () => {
    expect(customApiFixtureModeEnabled({} as never)).toBe(false);
  });

  it("is on in development when the flag is set", () => {
    expect(customApiFixtureModeEnabled({ CUSTOM_API_FIXTURE_MODE: "1" } as never)).toBe(true);
    expect(customApiFixtureModeEnabled({ CUSTOM_API_FIXTURE_MODE: "1", NODE_ENV: "test" } as never)).toBe(
      true,
    );
  });

  it("requires the explicit second opt-in in production, even with the main flag set", () => {
    expect(
      customApiFixtureModeEnabled({ CUSTOM_API_FIXTURE_MODE: "1", NODE_ENV: "production" } as never),
    ).toBe(false);
    expect(
      customApiFixtureModeEnabled({
        CUSTOM_API_FIXTURE_MODE: "1",
        NODE_ENV: "production",
        AUTHORITY_ALLOW_CUSTOM_API_FIXTURE: "1",
      } as never),
    ).toBe(true);
  });

  it("stays off in production even if only the second flag is set", () => {
    expect(
      customApiFixtureModeEnabled({
        NODE_ENV: "production",
        AUTHORITY_ALLOW_CUSTOM_API_FIXTURE: "1",
      } as never),
    ).toBe(false);
  });
});
