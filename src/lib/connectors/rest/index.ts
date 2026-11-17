import "server-only";

import type { AuthorityConnector } from "../types";

import { createRestConnector } from "./connector";
import { REST_CONNECTOR_SPECS } from "./providers";

let cached: AuthorityConnector[] | null = null;

/** One generic connector per declarative REST spec, built once per process. */
export function restConnectors(): AuthorityConnector[] {
  cached ??= REST_CONNECTOR_SPECS.map((spec) => createRestConnector(spec));
  return cached;
}
