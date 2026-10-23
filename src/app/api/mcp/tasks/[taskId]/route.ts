import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { authorizeAndExecuteMcpTool, buildMcpToolCatalog } from "@/lib/mcp/bridge";
import { extractBearer, UNAUTHENTICATED } from "@/lib/gateway/http";
import { failureContract } from "@/lib/gateway/response";
import { checkTaskReadAccess } from "@/lib/gateway/task-access";

/**
 * The MCP bridge (Phase 17 of the agent-integration roadmap): one Streamable
 * HTTP MCP server per task, at `/api/mcp/tasks/{taskId}`, authenticated with
 * the exact same runtime credential (`Authorization: Bearer`) every other
 * endpoint in docs/api/RUNTIME_API.md uses. An MCP client (Claude Desktop,
 * another agent harness) configured with this URL and that header sees
 * exactly the tools this task's active contract currently allows, and every
 * `tools/call` runs through the same authorize+execute pipeline as the REST
 * API -- see src/lib/mcp/bridge.ts's own module comment.
 *
 * Stateless mode (`sessionIdGenerator: undefined`): no MCP session is held
 * in server memory between requests, matching every other endpoint here --
 * each HTTP request is independently authenticated and handled, which is
 * also simply what a serverless Next.js deployment requires.
 *
 * Every request, including discovery (tools/list), first passes the same
 * credential check as REST `GET /tasks/{id}/tools` (gateway/task-access.ts):
 * the catalog is this task's active contract and can include a tenant's own
 * published operations, so it is not public metadata. Running a tool
 * (tools/call) is then authorized per call as before. A fresh McpServer and
 * transport are built per request; nothing is cached across requests or
 * across tasks.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BuildResult = { status: "ok"; server: McpServer } | { status: "task_not_found" | "no_active_contract" };

async function buildServerForTask(taskId: string, credentialSecret: string): Promise<BuildResult> {
  const catalog = await buildMcpToolCatalog(taskId);
  if (catalog.status !== "ok") return { status: catalog.status };

  const server = new McpServer({ name: "authority", version: "1.0.0" });
  for (const tool of catalog.tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const result = await authorizeAndExecuteMcpTool({
          credentialSecret,
          taskId,
          tool: tool.name,
          operation: tool.operation,
          args,
        });
        return {
          isError: !result.success,
          content: [
            { type: "text" as const, text: JSON.stringify({ summary: result.summary, ...result.body }) },
          ],
        };
      },
    );
  }
  return { status: "ok", server };
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) {
    return NextResponse.json(
      { error: { code: UNAUTHENTICATED.code, message: UNAUTHENTICATED.message } },
      { status: UNAUTHENTICATED.http },
    );
  }
  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success) {
    return NextResponse.json({ error: { code: "INVALID_TASK_ID" } }, { status: 400 });
  }

  const access = await checkTaskReadAccess(credentialSecret, taskId);
  if (!access.ok) {
    if (access.status === "task_not_found") {
      return NextResponse.json({ error: { code: "TASK_NOT_FOUND" } }, { status: 404 });
    }
    const failure = failureContract(access.status);
    return NextResponse.json(
      { error: { code: failure.code, message: failure.message } },
      { status: failure.http },
    );
  }

  const built = await buildServerForTask(taskId, credentialSecret);
  if (built.status === "task_not_found") {
    return NextResponse.json({ error: { code: "TASK_NOT_FOUND" } }, { status: 404 });
  }
  if (built.status === "no_active_contract") {
    return NextResponse.json({ error: { code: "NO_ACTIVE_CONTRACT" } }, { status: 409 });
  }
  if (built.status !== "ok") {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 });
  }
  const { server } = built;
  // Every tool call here is a single authorize-then-execute request/response
  // with no server-initiated progress notifications to stream -- a plain
  // JSON response is simpler and avoids SSE-unfriendly intermediaries
  // (proxies, load balancers) than the transport's default SSE stream.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
