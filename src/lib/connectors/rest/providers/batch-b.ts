import type { RestConnectorSpec } from "../spec";

import { airtable } from "./airtable";
import { asana } from "./asana";
import { calcom } from "./calcom";
import { calendly } from "./calendly";
import { clickup } from "./clickup";
import { clockify } from "./clockify";
import { coda } from "./coda";
import { figma } from "./figma";
import { harvest } from "./harvest";
import { jotform } from "./jotform";
import { miro } from "./miro";
import { monday } from "./monday";
import { shortcut } from "./shortcut";
import { smartsheet } from "./smartsheet";
import { todoist } from "./todoist";
import { toggl } from "./toggl";
import { trello } from "./trello";
import { typeform } from "./typeform";
import { wrike } from "./wrike";

/** Batch b of the declarative REST connectors (project management & productivity); each provider lives in its own file. */
export const batchB: RestConnectorSpec[] = [
  asana,
  trello,
  clickup,
  monday,
  todoist,
  airtable,
  coda,
  smartsheet,
  shortcut,
  wrike,
  figma,
  miro,
  calendly,
  typeform,
  harvest,
  toggl,
  clockify,
  calcom,
  jotform,
];
