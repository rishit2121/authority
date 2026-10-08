import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";

/**
 * A local, in-memory fixture API standing in for Notion's real REST API --
 * the Notion connector equivalent of Stripe's `StripeFixtureApi`
 * (./stripe-fixture-provider.ts). Injected as the connector's own `fetch`
 * dependency, never a real socket.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
  notionVersion: string | null;
}

export class NotionFixtureApi {
  readonly pages = new Map<string, { id: string; object: string; properties: Record<string, unknown> }>([
    ["page_1demo", { id: "page_1demo", object: "page", properties: { Name: { title: [] } } }],
  ]);
  readonly databases = new Set<string>(["db_1demo"]);
  readonly createdPages: Array<{ databaseId: string; title: string }> = [];
  readonly requests: RecordedRequest[] = [];
  requiredToken: string | null = null;

  /** Matches `NotionConnectorDeps["fetch"]` exactly -- drop-in for `safeFetch` in tests. */
  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requests.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
      notionVersion: input.headers["notion-version"] ?? null,
    });

    if (this.requiredToken && input.headers.authorization !== `Bearer ${this.requiredToken}`) {
      return jsonResponse(401, { object: "error", code: "unauthorized", message: "API token is invalid." });
    }

    if (input.method === "GET" && input.url.pathname === "/v1/users/me") {
      return jsonResponse(200, { object: "user", id: "bot_1demo", name: "Fixture bot" });
    }

    const pageMatch = /^\/v1\/pages\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && pageMatch) {
      const page = this.pages.get(pageMatch[1]);
      return page
        ? jsonResponse(200, page)
        : jsonResponse(404, { object: "error", code: "object_not_found" });
    }

    const queryMatch = /^\/v1\/databases\/([^/]+)\/query$/.exec(input.url.pathname);
    if (input.method === "POST" && queryMatch) {
      const databaseId = queryMatch[1];
      if (!this.databases.has(databaseId)) {
        return jsonResponse(404, { object: "error", code: "object_not_found" });
      }
      return jsonResponse(200, { object: "list", results: Array.from(this.pages.values()), has_more: false });
    }

    if (input.method === "POST" && input.url.pathname === "/v1/pages") {
      const body = input.body ? (JSON.parse(input.body) as Record<string, unknown>) : {};
      const parent = body.parent as { database_id?: string } | undefined;
      const databaseId = parent?.database_id;
      if (!databaseId || !this.databases.has(databaseId)) {
        return jsonResponse(400, { object: "error", code: "validation_error" });
      }
      const properties = body.properties as
        { Name?: { title?: Array<{ text?: { content?: string } }> } } | undefined;
      const title = properties?.Name?.title?.[0]?.text?.content ?? "";
      this.createdPages.push({ databaseId, title });
      const n = this.createdPages.length;
      return jsonResponse(200, {
        object: "page",
        id: `page_created_${n}`,
        properties: body.properties ?? {},
      });
    }

    return jsonResponse(404, { object: "error", code: "object_not_found", message: "no such route" });
  };
}

function jsonResponse(status: number, body: unknown): SafeFetchResult {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    bodyText: JSON.stringify(body),
    truncated: false,
  };
}
