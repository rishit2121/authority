import type { RestConnectorSpec } from "../spec";

import { batchA } from "./batch-a";
import { batchB } from "./batch-b";
import { batchC } from "./batch-c";
import { batchD } from "./batch-d";
import { batchE } from "./batch-e";
import { sentry } from "./sentry";
import { zendesk } from "./zendesk";

/** Every declarative REST connector, in catalog order within each batch. */
export const REST_CONNECTOR_SPECS: RestConnectorSpec[] = [
  sentry,
  zendesk,
  ...batchA,
  ...batchB,
  ...batchC,
  ...batchD,
  ...batchE,
];
