import type { RestConnectorSpec } from "../spec";

import { betterstack } from "./betterstack";
import { bitbucket } from "./bitbucket";
import { buildkite } from "./buildkite";
import { circleci } from "./circleci";
import { cloudflare } from "./cloudflare";
import { confluence } from "./confluence";
import { digitalocean } from "./digitalocean";
import { gitlab } from "./gitlab";
import { heroku } from "./heroku";
import { jira } from "./jira";
import { launchdarkly } from "./launchdarkly";
import { netlify } from "./netlify";
import { pagerduty } from "./pagerduty";
import { postman } from "./postman";
import { render } from "./render";
import { snyk } from "./snyk";
import { statuspage } from "./statuspage";
import { supabase } from "./supabase";
import { vercel } from "./vercel";

/** Batch a of the declarative REST connectors (developer tools & cloud); each provider lives in its own file. */
export const batchA: RestConnectorSpec[] = [
  gitlab,
  bitbucket,
  jira,
  confluence,
  pagerduty,
  betterstack,
  circleci,
  vercel,
  netlify,
  render,
  heroku,
  digitalocean,
  cloudflare,
  launchdarkly,
  statuspage,
  buildkite,
  snyk,
  postman,
  supabase,
];
