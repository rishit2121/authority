"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  describeAuthErrorForLog,
  INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_RESET_NEUTRAL_MESSAGE,
  presentAuthError,
  resolveSignUpOutcome,
  SIGNUP_NEUTRAL_MESSAGE,
} from "@/lib/auth/errors";
import { DEFAULT_AUTHENTICATED_PATH, safeReturnPath } from "@/lib/auth/redirect";
import { pilotSignupAllowed } from "@/lib/pilot/gateway";
import { createClient } from "@/lib/supabase/server";

/**
 * Server actions for the authentication flows.
 *
 * All validation and every provider call happens here, on the server. The
 * forms are progressive-enhancement plain `<form action={...}>` submissions,
 * so they work before hydration and there is no client-side auth logic to
 * bypass.
 */

export interface AuthFormState {
  error?: string;
  success?: string;
  /** Echoed back so a failed submit does not clear the field the user typed. */
  email?: string;
}

/** Minimum enforced by this application, above the project's own floor. */
const MIN_PASSWORD_LENGTH = 12;

const emailSchema = z.string().trim().min(3).max(320).pipe(z.email());

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(72, "Passwords are limited to 72 characters."); // bcrypt truncates beyond this

const signInSchema = z.object({
  email: emailSchema,
  // Not length-validated on sign-in: the rule may have changed since the
  // account was created, and a length complaint would be a wrong answer to a
  // correct password.
  password: z.string().min(1, "Enter your password."),
});

const signUpSchema = z
  .object({
    displayName: z.string().trim().min(1, "Enter your name.").max(120),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Those passwords don't match.",
    path: ["confirmPassword"],
  });

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Absolute origin for email links.
 *
 * Taken from the request headers rather than a build-time constant so the same
 * build works on localhost and on a deployed host. Supabase independently
 * refuses any redirect target not on the project's allow list, so a spoofed
 * Host header cannot redirect a reset link somewhere else.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin) return origin;

  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function signInAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = field(formData, "email");
  const parsed = signInSchema.safeParse({ email, password: field(formData, "password") });

  if (!parsed.success) {
    return { error: firstIssue(parsed.error), email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    console.warn(`auth: sign-in failed ${describeAuthErrorForLog(error)}`);
    return { error: presentAuthError(error) || INVALID_CREDENTIALS_MESSAGE, email };
  }

  // Validated here rather than trusted from the hidden field.
  redirect(safeReturnPath(field(formData, "next"), DEFAULT_AUTHENTICATED_PATH));
}

/** A brand-new account lands on the guided setup, not an empty overview. */
const NEW_ACCOUNT_PATH = "/app/setup";

export async function signUpAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = field(formData, "email");
  const parsed = signUpSchema.safeParse({
    displayName: field(formData, "displayName"),
    email,
    password: field(formData, "password"),
    confirmPassword: field(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return { error: firstIssue(parsed.error), email };
  }

  // Invite-only pilot: an address that is not approved gets the same neutral
  // response as a real sign-up and no account, so this form cannot be used to
  // check whether an address is approved. (An account created by calling
  // Supabase directly still gets nothing: the console and ensure_onboarded()
  // check approval themselves.)
  let allowed: boolean;
  try {
    allowed = await pilotSignupAllowed(parsed.data.email);
  } catch {
    return { error: "Sign-up is temporarily unavailable. Try again shortly.", email };
  }
  if (!allowed) {
    return { success: SIGNUP_NEUTRAL_MESSAGE, email };
  }

  const supabase = await createClient();
  const origin = await requestOrigin();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read by ensure_onboarded() to name the profile and default workspace.
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(NEW_ACCOUNT_PATH)}`,
    },
  });

  if (error) {
    console.warn(`auth: sign-up failed ${describeAuthErrorForLog(error)}`);
  }

  const outcome = resolveSignUpOutcome(error, Boolean(data?.session));
  if (outcome.kind === "authenticated") {
    redirect(NEW_ACCOUNT_PATH);
  }
  return { success: outcome.success, error: outcome.error, email };
}

export async function requestPasswordResetAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  const parsed = emailSchema.safeParse(email);

  if (!parsed.success) {
    return { error: "Enter a valid email address.", email };
  }

  const supabase = await createClient();
  const origin = await requestOrigin();

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${origin}/auth/callback?type=recovery`,
  });

  if (error) {
    // Logged, never shown. Surfacing the reason here would leak account
    // existence: Supabase sends no mail for an unknown address, so a
    // per-address send limit only ever trips for an address that *does* have
    // an account. Reporting "too many emails" would therefore confirm the
    // account exists, which is precisely what this endpoint must not do.
    console.warn(`auth: password reset request failed ${describeAuthErrorForLog(error)}`);
  }

  // One response for every outcome: sent, not sent, unknown address, rate
  // limited, or provider failure.
  return { success: PASSWORD_RESET_NEUTRAL_MESSAGE };
}

export async function updatePasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const password = field(formData, "password");
  const confirmPassword = field(formData, "confirmPassword");

  const parsed = passwordSchema.safeParse(password);

  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }

  if (password !== confirmPassword) {
    return { error: "Those passwords don't match." };
  }

  const supabase = await createClient();

  // The recovery link established a session at /auth/callback. Without one
  // there is nothing to update, and updateUser would fail less clearly.
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return {
      error: "That reset link has expired or was already used. Request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });

  if (error) {
    console.warn(`auth: password update failed ${describeAuthErrorForLog(error)}`);
    return { error: presentAuthError(error) };
  }

  redirect(DEFAULT_AUTHENTICATED_PATH);
}
