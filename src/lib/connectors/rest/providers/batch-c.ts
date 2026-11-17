import type { RestConnectorSpec } from "../spec";

import { affinity } from "./affinity";
import { apollo } from "./apollo";
import { attio } from "./attio";
import { capsule } from "./capsule";
import { closeCrm } from "./close_crm";
import { copper } from "./copper";
import { crisp } from "./crisp";
import { freshdesk } from "./freshdesk";
import { freshsales } from "./freshsales";
import { front } from "./front";
import { gong } from "./gong";
import { gorgias } from "./gorgias";
import { hubspot } from "./hubspot";
import { intercom } from "./intercom";
import { kustomer } from "./kustomer";
import { pipedrive } from "./pipedrive";
import { pylon } from "./pylon";
import { salesloft } from "./salesloft";
import { streak } from "./streak";

/** Batch c of the declarative REST connectors (CRM, sales & customer support); each provider has its own file. */
export const batchC: RestConnectorSpec[] = [
  hubspot,
  pipedrive,
  intercom,
  freshdesk,
  front,
  closeCrm,
  attio,
  freshsales,
  gorgias,
  kustomer,
  apollo,
  gong,
  streak,
  capsule,
  salesloft,
  affinity,
  copper,
  crisp,
  pylon,
];
