import "server-only";

import { ensureConnectorsRegistered } from "./register";
import { resolveConnectorForTool } from "./registry";

/**
 * The resource a tool call's own arguments identify, as computed by the
 * connector that will execute it -- the same `normalizeRequest()` the
 * executor runs before dispatch, where a mismatch with a caller-supplied
 * resource is already refused (`RESOURCE_MISMATCH`). Lets a caller omit
 * `resource` and get exactly the value an honest caller would have sent,
 * so agents don't need to know provider conventions like Slack's fixed
 * "workspace".
 *
 * Returns null when no connector owns the tool (GitHub keeps its own route)
 * or the arguments don't normalize; callers decide what that means.
 */
export async function deriveResource(tool: string, args: Record<string, unknown>): Promise<string | null> {
  ensureConnectorsRegistered();
  const connector = resolveConnectorForTool(tool);
  if (!connector) return null;
  try {
    const normalized = await connector.normalizeRequest(tool, args);
    return normalized.resource || null;
  } catch {
    return null;
  }
}
