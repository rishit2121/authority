import { describe, expect, it } from "vitest";

import {
  describeAuthErrorForLog,
  GENERIC_AUTH_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_RESET_NEUTRAL_MESSAGE,
  presentAuthError,
  SIGNUP_NEUTRAL_MESSAGE,
} from "@/lib/auth/errors";

describe("presentAuthError", () => {
  it("maps a known code to its message", () => {
    expect(presentAuthError({ code: "invalid_credentials" })).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(presentAuthError({ code: "over_request_rate_limit" })).toContain("Too many attempts");
    expect(presentAuthError({ code: "weak_password" })).toContain("12 characters");
  });

  it("falls back to message matching when no code is present", () => {
    expect(presentAuthError({ message: "Invalid login credentials" })).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(presentAuthError({ message: "Email not confirmed" })).toContain("Confirm your email");
  });

  it("returns the generic message for an unrecognized error", () => {
    expect(presentAuthError({ code: "some_new_code_from_a_future_release" })).toBe(GENERIC_AUTH_MESSAGE);
    expect(presentAuthError({})).toBe(GENERIC_AUTH_MESSAGE);
    expect(presentAuthError(null)).toBe(GENERIC_AUTH_MESSAGE);
    expect(presentAuthError(undefined)).toBe(GENERIC_AUTH_MESSAGE);
  });

  // The provider's own text is written for developers and sometimes names
  // internal subsystems. None of it should reach a user.
  it("never passes an unrecognized provider message through to the user", () => {
    const raw = 'pq: relation "auth.mfa_factors" does not exist (SQLSTATE 42P01)';
    expect(presentAuthError({ message: raw })).toBe(GENERIC_AUTH_MESSAGE);
    expect(presentAuthError({ message: raw })).not.toContain("SQLSTATE");
    expect(presentAuthError({ message: raw })).not.toContain("auth.mfa_factors");
  });

  it("does not echo a submitted email back from a provider message", () => {
    const raw = "User already registered: victim@example.com";
    expect(presentAuthError({ message: raw })).not.toContain("victim@example.com");
  });

  describe("user enumeration", () => {
    // A different message for "no such user" and "wrong password" turns the
    // login form into an account-existence oracle.
    it("uses one message for a missing account and a wrong password", () => {
      expect(presentAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(
        presentAuthError({ code: "invalid_credentials", message: "User not found" }),
      );
    });

    it("never states that an account does or does not exist", () => {
      const messages = [
        presentAuthError({ code: "invalid_credentials" }),
        presentAuthError({ code: "user_not_found" }),
        presentAuthError({ message: "User not found" }),
        GENERIC_AUTH_MESSAGE,
        PASSWORD_RESET_NEUTRAL_MESSAGE,
        SIGNUP_NEUTRAL_MESSAGE,
      ];

      for (const message of messages) {
        expect(message).not.toMatch(/no account|not registered|doesn't exist|does not exist|unknown user/i);
        expect(message).not.toMatch(/already registered|already exists|already taken/i);
      }
    });

    it("keeps the password-reset response conditional rather than confirming delivery", () => {
      // "If an account exists" — never "we sent you an email".
      expect(PASSWORD_RESET_NEUTRAL_MESSAGE).toMatch(/if an account exists/i);
    });
  });
});

describe("describeAuthErrorForLog", () => {
  it("reduces an error to its code and status", () => {
    expect(describeAuthErrorForLog({ code: "invalid_credentials", status: 400 })).toBe(
      "code=invalid_credentials status=400",
    );
  });

  it("handles a missing code", () => {
    expect(describeAuthErrorForLog({ status: 500 })).toBe("code=none status=500");
    expect(describeAuthErrorForLog(null)).toBe("unknown_error");
  });

  // Server logs are the other place secrets leak. The provider's message can
  // contain the submitted address, and transport errors can contain tokens.
  it("omits the provider message entirely", () => {
    const description = describeAuthErrorForLog({
      code: "invalid_credentials",
      status: 400,
      message: "Invalid login credentials for victim@example.com with token eyJhbGciOiJIUzI1NiJ9",
    });

    expect(description).not.toContain("victim@example.com");
    expect(description).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(description).toBe("code=invalid_credentials status=400");
  });
});
