import "server-only";

import { customApiConnector } from "./custom-api/connector";
import { registerConnector } from "./registry";

/**
 * Registers every statically-known connector, idempotently. Called lazily
 * from the executor (not at module import time) so that unit tests
 * exercising the registry in isolation (registry.test.ts) never see
 * connectors they didn't register themselves.
 *
 * Relies on `registerConnector`'s own duplicate-id guard rather than a local
 * "did I already do this" flag: an integration test that wants a
 * dependency-injected Custom API connector (a fake `fetch`, standing in for
 * a real provider) registers its own instance under the same "custom_" id
 * first -- this function's own attempt to register the default instance
 * then simply loses that race and is ignored, instead of throwing.
 *
 * GitHub is deliberately absent: it still has its own dedicated route and
 * executor (`/api/v1/github/execute`), unmigrated onto this interface (see
 * Phase 4 of the agent-integration roadmap) -- registering it here would
 * make it reachable from two different code paths with two different
 * execution histories, which is exactly the "two independently evolving
 * execution systems" risk that migration is meant to retire, not multiply.
 */
export function ensureConnectorsRegistered(): void {
  try {
    registerConnector(customApiConnector);
  } catch {
    // Already registered -- by an earlier call, or by a test that injected
    // its own instance under the same id. Either way, nothing to do.
  }
}
