import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The invite-only gate at each application entry point. The database is
 * mocked here; the database's own enforcement is covered by
 * src/tests/integration/pilot-access.test.ts.
 */

class RedirectSignal extends Error {
  constructor(public readonly location: string) {
    super(`redirect:${location}`);
  }
}

let viewer: { pv_access: string; pv_is_owner: boolean; pv_gate_enabled: boolean } = {
  pv_access: "eligible",
  pv_is_owner: false,
  pv_gate_enabled: true,
};
const rpc = vi.fn();
const signUp = vi.fn();
const exchangeCodeForSession = vi.fn();
const pilotSignupAllowed = vi.fn();

function queryChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "abortSignal", "limit", "in"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return chain;
}

vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ host: "authority.example", "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/pilot/gateway", () => ({
  pilotSignupAllowed: (...a: unknown[]) => pilotSignupAllowed(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "u1", email: "dev@x.test", user_metadata: {} } },
        error: null,
      }),
      signUp: (...a: unknown[]) => signUp(...a),
      exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a),
    },
    rpc: (name: string, args?: unknown) => {
      rpc(name, args);
      if (name === "pilot_viewer") return Promise.resolve({ data: [viewer], error: null });
      return Promise.resolve({ data: [], error: null });
    },
    from: () =>
      queryChain({
        data: [
          {
            tenant_id: "t1",
            role: "owner",
            tenants: { id: "t1", name: "W", slug: "w", environment: "development", created_at: "" },
          },
        ],
        error: null,
      }),
  }),
}));

const { loadIdentity } = await import("@/lib/auth/identity");
const { signUpAction } = await import("@/app/(auth)/actions");
const { GET: callback } = await import("@/app/auth/callback/route");
const { GET: campaign } = await import("@/app/api/validation/campaigns/[id]/route");
const { SIGNUP_NEUTRAL_MESSAGE } = await import("@/lib/auth/errors");

beforeEach(() => {
  rpc.mockClear();
  signUp.mockReset();
  pilotSignupAllowed.mockReset();
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
});

describe("console identity", () => {
  it("redirects a verified but unapproved account to /invite-only before any onboarding", async () => {
    viewer = { pv_access: "not_approved", pv_is_owner: false, pv_gate_enabled: true };
    await expect(loadIdentity()).rejects.toMatchObject({ location: "/invite-only" });
    expect(rpc).not.toHaveBeenCalledWith("ensure_onboarded", undefined);
  });

  it("loads an approved account and carries the owner flag from the database", async () => {
    viewer = { pv_access: "eligible", pv_is_owner: true, pv_gate_enabled: true };
    const identity = await loadIdentity();
    expect(identity?.isPilotOwner).toBe(true);
    viewer = { pv_access: "eligible", pv_is_owner: false, pv_gate_enabled: true };
    expect((await loadIdentity())?.isPilotOwner).toBe(false);
  });
});

function signUpForm(email: string): FormData {
  const fd = new FormData();
  fd.set("displayName", "Dev");
  fd.set("email", email);
  fd.set("password", "a-long-password-123");
  fd.set("confirmPassword", "a-long-password-123");
  return fd;
}

describe("sign-up", () => {
  it("gives an unapproved address the neutral response and creates no account", async () => {
    pilotSignupAllowed.mockResolvedValue(false);
    const r = await signUpAction({}, signUpForm("stranger@x.test"));
    expect(r.success).toBe(SIGNUP_NEUTRAL_MESSAGE);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("lets an approved address sign up normally (email confirmation still required)", async () => {
    pilotSignupAllowed.mockResolvedValue(true);
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    const r = await signUpAction({}, signUpForm("approved@x.test"));
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(r.success).toBe(SIGNUP_NEUTRAL_MESSAGE);
  });

  it("fails closed when the approval check is unavailable", async () => {
    pilotSignupAllowed.mockRejectedValue(new Error("db"));
    const r = await signUpAction({}, signUpForm("approved@x.test"));
    expect(r.error).toMatch(/temporarily unavailable/);
    expect(signUp).not.toHaveBeenCalled();
  });
});

describe("auth callback", () => {
  const req = (qs: string) =>
    ({ nextUrl: new URL(`https://authority.example/auth/callback?${qs}`) }) as never;

  it("sends an unapproved confirmed user to /invite-only instead of the console", async () => {
    viewer = { pv_access: "not_approved", pv_is_owner: false, pv_gate_enabled: true };
    const res = await callback(req("code=abc&next=/app/setup"));
    expect(res.headers.get("location")).toBe("/invite-only");
  });

  it("sends an approved user on to the requested page", async () => {
    viewer = { pv_access: "eligible", pv_is_owner: false, pv_gate_enabled: true };
    const res = await callback(req("code=abc&next=/app/setup"));
    expect(res.headers.get("location")).toBe("/app/setup");
  });
});

describe("session APIs", () => {
  it("refuses an unapproved user with 403", async () => {
    viewer = { pv_access: "not_approved", pv_is_owner: false, pv_gate_enabled: true };
    const res = await campaign({} as never, {
      params: Promise.resolve({ id: "11111111-2222-4333-8444-555555555555" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invite_only" });
  });
});
