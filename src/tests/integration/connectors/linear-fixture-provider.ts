import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";

/**
 * A local, in-memory fixture API standing in for Linear's real GraphQL
 * endpoint -- the Linear connector equivalent of Stripe's `StripeFixtureApi`
 * (./stripe-fixture-provider.ts). Injected as the connector's own `fetch`
 * dependency, never a real socket. Routes by substring-matching the fixed
 * query/mutation string each operation sends (see connector.ts's own
 * `planRequest`), since every request here is a single POST to one endpoint
 * rather than Stripe's per-operation path.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
  query: string;
}

interface FixtureIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  state: { name: string };
  assignee: { name: string } | null;
}

export class LinearFixtureApi {
  readonly issues = new Map<string, FixtureIssue>([
    [
      "issue_1demo",
      {
        id: "issue_1demo",
        identifier: "ENG-1",
        title: "Demo issue",
        description: "A fixture issue.",
        url: "https://linear.app/demo/issue/ENG-1",
        state: { name: "Todo" },
        assignee: null,
      },
    ],
  ]);
  readonly teams = new Set<string>(["team_1demo"]);
  readonly createdIssues: Array<{ teamId: string; title: string; description: string | null }> = [];
  readonly requests: RecordedRequest[] = [];
  requiredApiKey: string | null = null;

  /** Matches `LinearConnectorDeps["fetch"]` exactly -- drop-in for `safeFetch` in tests. */
  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    const parsed = input.body
      ? (JSON.parse(input.body) as { query: string; variables: Record<string, unknown> })
      : { query: "", variables: {} };
    this.requests.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
      query: parsed.query,
    });

    if (this.requiredApiKey && input.headers.authorization !== this.requiredApiKey) {
      return jsonResponse(401, { errors: [{ message: "Authentication required, no valid token provided" }] });
    }

    const { query, variables } = parsed;

    if (query.includes("viewer")) {
      return jsonResponse(200, { data: { viewer: { id: "user_1demo" } } });
    }

    if (query.includes("issueCreate")) {
      const teamId = variables.teamId as string;
      if (!this.teams.has(teamId)) return jsonResponse(200, { errors: [{ message: "Entity not found" }] });
      const title = variables.title as string;
      const description = (variables.description as string | null) ?? null;
      this.createdIssues.push({ teamId, title, description });
      const n = this.createdIssues.length;
      return jsonResponse(200, {
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: `issue_created_${n}`,
              identifier: `ENG-${n + 1}`,
              url: `https://linear.app/demo/issue/ENG-${n + 1}`,
            },
          },
        },
      });
    }

    if (query.includes("issues(filter")) {
      const teamId = variables.teamId as string;
      if (!this.teams.has(teamId)) return jsonResponse(200, { data: { issues: { nodes: [] } } });
      const nodes = Array.from(this.issues.values()).map((i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        url: i.url,
        state: i.state,
      }));
      return jsonResponse(200, { data: { issues: { nodes } } });
    }

    if (query.includes("issue(id:")) {
      const issue = this.issues.get(variables.id as string);
      if (!issue) return jsonResponse(200, { errors: [{ message: "Entity not found" }] });
      return jsonResponse(200, { data: { issue } });
    }

    return jsonResponse(200, { errors: [{ message: "no such query on the fixture API" }] });
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
