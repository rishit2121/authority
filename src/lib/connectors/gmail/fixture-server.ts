import "server-only";

import type { SafeFetchInput, SafeFetchResult } from "../custom-api/network-guard";

/**
 * The in-process fake Google OAuth token endpoint + Gmail API, reachable
 * only at `GMAIL_FIXTURE_HOSTNAME` and only when `gmailFixtureModeEnabled()`
 * is true (see fixture-mode.ts). Handles both the authorization-code and
 * refresh-token grant types (POST /token), the Gmail send endpoint
 * (POST /gmail/v1/users/me/messages/send), and the three read endpoints
 * (GET .../messages, GET .../messages/{id}, GET .../labels) -- Gmail's own
 * connector equivalent of ../stripe/fixture-server.ts.
 */
export interface FixtureSentMessage {
  raw: string;
  authorization: string | null;
}

const FIXTURE_MESSAGES: Record<string, { id: string; threadId: string; snippet: string }> = {
  "fixture-msg-read-1": {
    id: "fixture-msg-read-1",
    threadId: "fixture-thread-read-1",
    snippet: "Hello from the fixture inbox.",
  },
};
const FIXTURE_LABELS = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "SENT", name: "SENT", type: "system" },
];

class GmailFixtureServer {
  sentMessages: FixtureSentMessage[] = [];
  requestLog: Array<{ method: string; path: string; at: string }> = [];
  /** When set, the fake Gmail API rejects every send with an invalid-credentials error. */
  rejectAccessToken: string | null = null;

  reset(): void {
    this.sentMessages = [];
    this.requestLog = [];
    this.rejectAccessToken = null;
  }

  handle = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requestLog.push({ method: input.method, path: input.url.pathname, at: new Date().toISOString() });

    if (input.method === "POST" && input.url.pathname === "/token") {
      const params = new URLSearchParams(input.body ?? "");
      const grantType = params.get("grant_type");
      if (grantType === "authorization_code") {
        const code = params.get("code");
        if (!code || !code.startsWith("fixture-code-")) {
          return json(400, { error: "invalid_grant" });
        }
        return json(200, {
          access_token: "fixture-access-token",
          refresh_token: `fixture-refresh-${code.slice("fixture-code-".length)}`,
          expires_in: 3599,
          token_type: "Bearer",
        });
      }
      if (grantType === "refresh_token") {
        const refreshToken = params.get("refresh_token");
        if (!refreshToken || !refreshToken.startsWith("fixture-refresh-")) {
          return json(400, { error: "invalid_grant" });
        }
        return json(200, { access_token: "fixture-access-token", expires_in: 3599, token_type: "Bearer" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }

    if (input.method === "POST" && input.url.pathname === "/gmail/v1/users/me/messages/send") {
      const auth = input.headers.authorization ?? null;
      if (this.rejectAccessToken !== null || auth !== "Bearer fixture-access-token") {
        return json(401, { error: { code: 401, message: "Invalid Credentials" } });
      }
      const body = JSON.parse(input.body ?? "{}") as { raw?: string };
      if (!body.raw) return json(400, { error: { code: 400, message: "Missing raw message" } });
      this.sentMessages.push({ raw: body.raw, authorization: auth });
      return json(200, { id: `fixture-msg-${this.sentMessages.length}`, threadId: "fixture-thread-1" });
    }

    if (input.method === "GET" && input.url.pathname === "/gmail/v1/users/me/messages") {
      if (input.headers.authorization !== "Bearer fixture-access-token") {
        return json(401, { error: { code: 401, message: "Invalid Credentials" } });
      }
      const ids = Object.values(FIXTURE_MESSAGES).map((m) => ({ id: m.id, threadId: m.threadId }));
      return json(200, { messages: ids, resultSizeEstimate: ids.length });
    }

    const messageMatch = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && messageMatch) {
      if (input.headers.authorization !== "Bearer fixture-access-token") {
        return json(401, { error: { code: 401, message: "Invalid Credentials" } });
      }
      const found = FIXTURE_MESSAGES[messageMatch[1]];
      if (!found) return json(404, { error: { code: 404, message: "Not Found" } });
      return json(200, found);
    }

    if (input.method === "GET" && input.url.pathname === "/gmail/v1/users/me/labels") {
      if (input.headers.authorization !== "Bearer fixture-access-token") {
        return json(401, { error: { code: 401, message: "Invalid Credentials" } });
      }
      return json(200, { labels: FIXTURE_LABELS });
    }

    return json(404, { error: { code: 404, message: "no such route on the fixture API" } });
  };
}

function json(status: number, body: unknown): SafeFetchResult {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    bodyText: JSON.stringify(body),
    truncated: false,
  };
}

const globalForFixture = globalThis as unknown as { __gmailFixtureServer?: GmailFixtureServer };

export function gmailFixtureServer(): GmailFixtureServer {
  if (!globalForFixture.__gmailFixtureServer) {
    globalForFixture.__gmailFixtureServer = new GmailFixtureServer();
  }
  return globalForFixture.__gmailFixtureServer;
}
