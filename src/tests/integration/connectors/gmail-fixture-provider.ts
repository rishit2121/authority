import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";

/**
 * A local, in-memory fixture standing in for BOTH Google's OAuth token
 * endpoint and the Gmail API -- the Gmail connector equivalent of
 * ./stripe-fixture-provider.ts. Injected as `GmailConnectorDeps.fetch` and
 * passed through to `refreshAccessToken` the same way.
 */
export interface RecordedRequest {
  method: string;
  path: string;
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

export class GmailFixtureApi {
  readonly sentMessages: Array<{ raw: string }> = [];
  readonly requests: RecordedRequest[] = [];
  /** Setting this makes every refresh_token grant fail, simulating a revoked/expired refresh token. */
  rejectRefreshToken = false;

  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requests.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
    });

    if (input.method === "POST" && input.url.pathname === "/token") {
      const params = new URLSearchParams(input.body ?? "");
      const grantType = params.get("grant_type");
      if (grantType === "refresh_token") {
        if (this.rejectRefreshToken) return json(400, { error: "invalid_grant" });
        const refreshToken = params.get("refresh_token");
        if (!refreshToken) return json(400, { error: "invalid_grant" });
        return json(200, { access_token: "fixture-access-token", expires_in: 3599, token_type: "Bearer" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }

    if (input.method === "POST" && input.url.pathname === "/gmail/v1/users/me/messages/send") {
      const auth = input.headers.authorization ?? null;
      if (auth !== "Bearer fixture-access-token") {
        return json(401, { error: { code: 401, message: "Invalid Credentials" } });
      }
      const body = JSON.parse(input.body ?? "{}") as { raw?: string };
      if (!body.raw) return json(400, { error: { code: 400, message: "Missing raw message" } });
      this.sentMessages.push({ raw: body.raw });
      return json(200, { id: `fixture-msg-${this.sentMessages.length}`, threadId: "fixture-thread-1" });
    }

    if (input.method === "GET" && input.url.pathname === "/gmail/v1/users/me/messages") {
      const auth = input.headers.authorization ?? null;
      if (auth !== "Bearer fixture-access-token") {
        return json(401, { error: { code: 401, message: "Invalid Credentials" } });
      }
      const ids = Object.values(FIXTURE_MESSAGES).map((m) => ({ id: m.id, threadId: m.threadId }));
      return json(200, { messages: ids, resultSizeEstimate: ids.length });
    }

    const messageMatch = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && messageMatch) {
      const auth = input.headers.authorization ?? null;
      if (auth !== "Bearer fixture-access-token") {
        return json(401, { error: { code: 401, message: "Invalid Credentials" } });
      }
      const found = FIXTURE_MESSAGES[messageMatch[1]];
      if (!found) return json(404, { error: { code: 404, message: "Not Found" } });
      return json(200, found);
    }

    if (input.method === "GET" && input.url.pathname === "/gmail/v1/users/me/labels") {
      const auth = input.headers.authorization ?? null;
      if (auth !== "Bearer fixture-access-token") {
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
