import type { RestConnectorSpec } from "../spec";

import { ashby } from "./ashby";
import { bamboohr } from "./bamboohr";
import { brex } from "./brex";
import { chargebee } from "./chargebee";
import { cloudinary } from "./cloudinary";
import { contentful } from "./contentful";
import { deel } from "./deel";
import { elevenlabs } from "./elevenlabs";
import { lever } from "./lever";
import { mercury } from "./mercury";
import { mistral } from "./mistral";
import { openai } from "./openai";
import { paddle } from "./paddle";
import { pinecone } from "./pinecone";
import { recurly } from "./recurly";
import { replicate } from "./replicate";
import { sanity } from "./sanity";
import { square } from "./square";
import { storyblok } from "./storyblok";
import { workable } from "./workable";

/** Batch e of the declarative REST connectors; each provider lives in its own file in this folder. */
export const batchE: RestConnectorSpec[] = [
  // Commerce & payments
  square,
  paddle,
  // Finance & accounting
  chargebee,
  recurly,
  brex,
  mercury,
  // HR & recruiting
  bamboohr,
  lever,
  ashby,
  workable,
  deel,
  // Content & design
  contentful,
  sanity,
  cloudinary,
  storyblok,
  // AI & ML
  openai,
  mistral,
  elevenlabs,
  replicate,
  pinecone,
];
