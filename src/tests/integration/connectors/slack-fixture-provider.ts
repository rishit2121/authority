import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";

/**
 * A local, in-memory fixture API standing in for the real Slack Web API --
 * the Slack connector equivalent of Custom API's `WidgetOrdersFixtureApi`
 * and Stripe's `StripeFixtureApi` (./stripe-fixture-provider.ts). Injected
 * as the connector's own `fetch` dependency (`SlackConnectorDeps.fetch`).
 * Reproduces Slack's own convention of HTTP 200 on every response with
 * success/failure carried in the JSON body's `ok` field.
 */
export interface FixtureChannel {
  id: string;
  name: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
}

export class SlackFixtureApi {
  readonly channels: FixtureChannel[] = [
    { id: "C1DEMO", name: "general" },
    { id: "C2DEMO", name: "incidents" },
  ];
  readonly messages: Array<{ channel: string; text: string; ts: string }> = [];
  readonly requests: RecordedRequest[] = [];
  requiredBotToken: string | null = null;

  /** Matches `SlackConnectorDeps["fetch"]` exactly -- drop-in for `safeFetch` in tests. */
  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requests.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
    });

    if (this.requiredBotToken && input.headers.authorization !== `Bearer ${this.requiredBotToken}`) {
      return slackJson({ ok: false, error: "invalid_auth" });
    }

    if (input.method === "POST" && input.url.pathname === "/api/chat.postMessage") {
      const body = JSON.parse(input.body ?? "{}") as { channel?: string; text?: string };
      if (!body.channel) return slackJson({ ok: false, error: "channel_not_found" });
      if (!body.text) return slackJson({ ok: false, error: "no_text" });
      const channel = this.channels.find((c) => c.id === body.channel);
      if (!channel) return slackJson({ ok: false, error: "channel_not_found" });
      const ts = `${Date.now() / 1000}.${this.messages.length}`;
      this.messages.push({ channel: body.channel, text: body.text, ts });
      return slackJson({ ok: true, channel: body.channel, ts, message: { text: body.text } });
    }

    if (input.method === "GET" && input.url.pathname === "/api/conversations.list") {
      return slackJson({ ok: true, channels: this.channels });
    }

    if (input.method === "POST" && input.url.pathname === "/api/auth.test") {
      return slackJson({ ok: true, team: "Fixture Workspace", user: "authority-bot" });
    }

    return slackJson({ ok: false, error: "fixture_route_not_found" });
  };
}

function slackJson(body: unknown): SafeFetchResult {
  return {
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    bodyText: JSON.stringify(body),
    truncated: false,
  };
}
