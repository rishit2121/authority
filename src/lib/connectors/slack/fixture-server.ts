import "server-only";

import type { SafeFetchInput, SafeFetchResult } from "../custom-api/network-guard";

/**
 * The in-process fake Slack Web API, reachable only at
 * `SLACK_FIXTURE_HOSTNAME` and only when `slackFixtureModeEnabled()` is
 * true (see fixture-mode.ts). Slack's own API convention -- HTTP 200 on
 * every response, success/failure carried in the JSON body's `ok` field --
 * is reproduced here exactly, since the real connector must handle that
 * convention, not an HTTP-status one.
 */
export interface FixtureChannel {
  id: string;
  name: string;
}

export interface FixtureRequestLogEntry {
  method: string;
  path: string;
  authorization: string | null;
  at: string;
}

function initialChannels(): FixtureChannel[] {
  return [
    { id: "C1DEMO", name: "general" },
    { id: "C2DEMO", name: "incidents" },
  ];
}

class SlackFixtureServer {
  channels = initialChannels();
  messages: Array<{ channel: string; text: string; ts: string }> = [];
  requestLog: FixtureRequestLogEntry[] = [];

  reset(): void {
    this.channels = initialChannels();
    this.messages = [];
    this.requestLog = [];
  }

  handle = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requestLog.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
      at: new Date().toISOString(),
    });

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

const globalForFixture = globalThis as unknown as { __slackFixtureServer?: SlackFixtureServer };

export function slackFixtureServer(): SlackFixtureServer {
  if (!globalForFixture.__slackFixtureServer) {
    globalForFixture.__slackFixtureServer = new SlackFixtureServer();
  }
  return globalForFixture.__slackFixtureServer;
}
