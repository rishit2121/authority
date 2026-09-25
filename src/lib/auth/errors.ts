/**
 * Auth error presentation.
 *
 * Two properties this module exists to guarantee:
 *
 *  1. A raw Supabase error never reaches the user. Provider messages change
 *     between releases, sometimes name internal subsystems, and are written
 *     for developers.
 *  2. No message distinguishes "no such account" from "wrong password", and no
 *     sign-up or password-reset response reveals whether an address is already
 *     registered. An attacker must not be able to use this application to
 *     enumerate who has an account.
 */

/** Shape of what `@supabase/supabase-js` returns, without importing its types. */
export interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

export const GENERIC_AUTH_MESSAGE = "Something went wrong. Please try again.";

/**
 * Deliberately identical for a missing account and a wrong password. Supabase
 * returns `invalid_credentials` for both, and this message must not be more
 * specific than that.
 */
export const INVALID_CREDENTIALS_MESSAGE = "That email and password combination isn't correct.";

const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: INVALID_CREDENTIALS_MESSAGE,
  // Only reachable once the password is already correct, so it reveals nothing
  // a successful sign-in would not.
  email_not_confirmed: "Confirm your email address before signing in. Check your inbox for the link.",
  email_address_invalid: "Enter a valid email address.",
  weak_password: "Choose a stronger password — at least 12 characters.",
  same_password: "Choose a password you haven't used for this account before.",
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  over_email_send_rate_limit: "Too many emails requested. Wait a few minutes and try again.",
  otp_expired: "That link has expired. Request a new one.",
  reauthentication_needed: "Sign in again to make this change.",
  session_expired: "Your session expired. Sign in again.",
  validation_failed: "Check the form and try again.",
  signup_disabled: "New accounts are not being accepted right now.",
};

/**
 * Message-text fallbacks for responses that arrive without a `code`. Matched
 * case-insensitively on a substring, and only for messages stable enough to
 * rely on.
 */
const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/invalid login credentials/i, INVALID_CREDENTIALS_MESSAGE],
  [/email not confirmed/i, CODE_MESSAGES.email_not_confirmed],
  [/rate limit/i, CODE_MESSAGES.over_request_rate_limit],
  [/password should be at least/i, CODE_MESSAGES.weak_password],
  [/token has expired or is invalid/i, CODE_MESSAGES.otp_expired],
];

/** Maps a provider error to a message that is safe to render. */
export function presentAuthError(error: AuthErrorLike | null | undefined): string {
  if (!error) return GENERIC_AUTH_MESSAGE;

  if (error.code && error.code in CODE_MESSAGES) {
    return CODE_MESSAGES[error.code];
  }

  if (typeof error.message === "string") {
    for (const [pattern, message] of MESSAGE_PATTERNS) {
      if (pattern.test(error.message)) return message;
    }
  }

  // Unrecognized. Return the generic message rather than passing the
  // provider's text through.
  return GENERIC_AUTH_MESSAGE;
}

/**
 * The single response shown after a password-reset request, whether or not the
 * address exists. Any branch here would leak account existence.
 */
export const PASSWORD_RESET_NEUTRAL_MESSAGE =
  "If an account exists for that address, a reset link is on its way. Check your inbox and spam folder.";

/**
 * The single response shown after sign-up when no session is returned, which
 * happens both for a genuinely new account awaiting confirmation and for an
 * address that is already registered.
 */
export const SIGNUP_NEUTRAL_MESSAGE =
  "Check your inbox for a confirmation link to finish setting up your account.";

/**
 * Reduces an error to something safe to log: the code and status only.
 *
 * Provider messages can embed the submitted email, and tokens can appear in
 * transport errors. Neither belongs in a server log.
 */
export function describeAuthErrorForLog(error: AuthErrorLike | null | undefined): string {
  if (!error) return "unknown_error";
  const parts = [`code=${error.code ?? "none"}`];
  if (typeof error.status === "number") parts.push(`status=${error.status}`);
  return parts.join(" ");
}

export type SignUpOutcome =
  { kind: "authenticated" } | { kind: "response"; success?: string; error?: string };

/**
 * The full sign-up enumeration-resistance decision, extracted from
 * `signUpAction` so the security property it exists to guarantee — a brand
 * new address and one that already exists are indistinguishable — can be
 * unit-tested deterministically, without a live Supabase project's email
 * delivery or rate-limit behavior in the loop. `signUpAction` itself calls
 * this with whatever `supabase.auth.signUp()` actually returned; nothing
 * about the decision changes, only where it can be exercised from.
 *
 * `hasSession` corresponds to `Boolean(data?.session)`: with email
 * confirmation enabled, a genuinely new signup and an already-registered
 * address both return a user with no session, which is exactly what makes
 * the neutral message both safe and accurate for either case.
 */
export function resolveSignUpOutcome(
  error: AuthErrorLike | null | undefined,
  hasSession: boolean,
): SignUpOutcome {
  if (error) {
    // An "already registered" response must not be distinguishable from
    // success, or this form becomes an account-existence oracle.
    if (error.code === "user_already_exists" || /already registered/i.test(error.message ?? "")) {
      return { kind: "response", success: SIGNUP_NEUTRAL_MESSAGE };
    }

    // Email send throttling is also answered neutrally. It is not an
    // account-dependent condition, but letting the response vary at all on
    // this endpoint creates a channel where there should be none — and the
    // neutral message already tells the user to check their inbox and retry.
    // Everything else (weak password, invalid address, signup disabled)
    // describes the submitted input rather than the account, and is surfaced.
    if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { kind: "response", success: SIGNUP_NEUTRAL_MESSAGE };
    }

    return { kind: "response", error: presentAuthError(error) };
  }

  // With email confirmation enabled, signUp returns a user but no session.
  if (!hasSession) {
    return { kind: "response", success: SIGNUP_NEUTRAL_MESSAGE };
  }

  return { kind: "authenticated" };
}
