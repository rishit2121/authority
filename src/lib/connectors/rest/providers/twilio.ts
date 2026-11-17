import type { RestConnectorSpec } from "../spec";

/**
 * https://www.twilio.com/docs/messaging/api/message-resource -- basic auth with the Account SID as username and the
 * Auth Token as password; the SID is also part of every path.
 */
export const twilio: RestConnectorSpec = {
  id: "twilio",
  name: "Twilio",
  description: "List your phone numbers and messages, read one message, and send one SMS to a pinned number.",
  category: "Communication",
  docsUrl: "https://www.twilio.com/docs/messaging/api/message-resource",
  iconSlug: "twilio",
  host: "api.twilio.com",
  basePath: "/2010-04-01/Accounts/{config.account_sid}",
  credential: {
    label: "Auth token",
    help: "Twilio Console → Account → API keys & tokens → Auth Token. Use it with the Account SID below.",
  },
  configFields: [
    {
      key: "account_sid",
      label: "Account SID",
      placeholder: "AC…",
      help: "Shown on the Twilio Console home page.",
      pattern: "^AC[0-9a-f]{32}$",
    },
  ],
  auth: { basic: { username: "{config.account_sid}", password: "{key}" } },
  verify: { method: "GET", path: "/IncomingPhoneNumbers.json?PageSize=1" },
  operations: [
    {
      slug: "list_phone_numbers",
      summary: "Lists the phone numbers on the account (usable as senders).",
      method: "GET",
      path: "/IncomingPhoneNumbers.json",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_messages",
      summary: "Lists recent messages, optionally only those to or from one number.",
      method: "GET",
      path: "/Messages.json",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      fixedQuery: { PageSize: "50" },
      args: [
        {
          key: "to",
          in: "query",
          target: "To",
          required: false,
          description: "Only messages sent to this E.164 number.",
        },
        {
          key: "from",
          in: "query",
          target: "From",
          required: false,
          description: "Only messages sent from this E.164 number.",
        },
      ],
    },
    {
      slug: "get_message",
      summary: "Returns one message's status, body and price.",
      method: "GET",
      path: "/Messages/{message_sid}.json",
      sideEffect: "read",
      resourceType: "message",
      resource: "message_sid",
      dataSensitivity: "confidential",
      args: [
        { key: "message_sid", in: "path", required: true, description: "The message SID (SM… or MM…)." },
      ],
    },
    {
      slug: "send_sms",
      summary: "Sends one SMS from one of your numbers to one recipient; nothing else.",
      method: "POST",
      path: "/Messages.json",
      sideEffect: "write_create",
      resourceType: "phone_number",
      resource: "to",
      body: "form",
      externalCommunication: true,
      args: [
        {
          key: "to",
          in: "body",
          target: "To",
          required: true,
          description: "Recipient number in E.164 format, e.g. +15551234567.",
        },
        {
          key: "from",
          in: "body",
          target: "From",
          required: true,
          description: "One of your Twilio numbers in E.164 format.",
        },
        {
          key: "body",
          in: "body",
          target: "Body",
          required: true,
          freeText: true,
          description: "Message text.",
        },
      ],
    },
  ],
};
