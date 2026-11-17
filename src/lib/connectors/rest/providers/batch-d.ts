import type { RestConnectorSpec } from "../spec";
import { activecampaign } from "./activecampaign";
import { amplitude } from "./amplitude";
import { brevo } from "./brevo";
import { customerIo } from "./customer_io";
import { discord } from "./discord";
import { kit } from "./kit";
import { klaviyo } from "./klaviyo";
import { loops } from "./loops";
import { mailchimp } from "./mailchimp";
import { mailgun } from "./mailgun";
import { mailjet } from "./mailjet";
import { mixpanel } from "./mixpanel";
import { plausible } from "./plausible";
import { postmark } from "./postmark";
import { posthog } from "./posthog";
import { resend } from "./resend";
import { sendgrid } from "./sendgrid";
import { twilio } from "./twilio";
import { webflow } from "./webflow";

/** Batch d of the declarative REST connectors; each provider lives in its own file in this folder. */
export const batchD: RestConnectorSpec[] = [
  sendgrid,
  mailgun,
  postmark,
  mailchimp,
  brevo,
  resend,
  twilio,
  discord,
  klaviyo,
  customerIo,
  kit,
  activecampaign,
  mailjet,
  loops,
  mixpanel,
  posthog,
  plausible,
  amplitude,
  webflow,
];
