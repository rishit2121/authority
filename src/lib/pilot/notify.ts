/**
 * Optional "new pilot request" email to the platform owner, via Resend's
 * HTTP API. Backend-only and fixed-recipient: the address comes from
 * pilot_settings (returned by the submit function), never from the form.
 * It never uses any applicant's connected account.
 *
 * Never throws: the request is already saved before this runs, and a
 * delivery failure only changes the recorded notification status.
 * Retries cannot duplicate: it runs once per newly created request, and the
 * request id is sent as Resend's Idempotency-Key.
 */

export type PilotNotificationStatus = "sent" | "failed" | "not_configured";

export interface PilotNotificationInput {
  requestId: string;
  ownerEmail: string;
  name: string;
  email: string;
  company: string | null;
  building: string;
  usage: string;
  services: string | null;
  dashboardUrl: string | null;
}

export interface PilotNotificationResult {
  status: PilotNotificationStatus;
  /** Safe to store: never contains the API key or the response body. */
  detail: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Header-safe single line: no CR/LF, bounded. */
function oneLine(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, max);
}

export function buildPilotNotification(input: PilotNotificationInput): {
  subject: string;
  html: string;
  text: string;
} {
  const rows: [string, string | null][] = [
    ["Name", input.name],
    ["Email", input.email],
    ["Company / project", input.company],
    ["What they're building", input.building],
    ["How they'd use Authority", input.usage],
    ["Services / tools", input.services],
  ];
  const present = rows.filter((r): r is [string, string] => Boolean(r[1]));
  const html = [
    `<p>New Authority pilot request.</p>`,
    `<table cellpadding="6" style="border-collapse:collapse">`,
    ...present.map(
      ([k, v]) =>
        `<tr><td style="vertical-align:top;color:#555"><strong>${escapeHtml(k)}</strong></td><td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`,
    ),
    `</table>`,
    input.dashboardUrl
      ? `<p><a href="${escapeHtml(input.dashboardUrl)}">Review it in the pilot dashboard</a></p>`
      : "",
  ].join("");
  const text = [
    "New Authority pilot request.",
    "",
    ...present.map(([k, v]) => `${k}: ${v}`),
    "",
    input.dashboardUrl ? `Review: ${input.dashboardUrl}` : "",
  ].join("\n");
  return { subject: oneLine(`Authority pilot request: ${input.name}`, 150), html, text };
}

export async function sendPilotNotification(
  input: PilotNotificationInput,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PilotNotificationResult> {
  const env = options.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.PILOT_NOTIFY_FROM?.trim();
  if (!apiKey || !from)
    return { status: "not_configured", detail: "RESEND_API_KEY or PILOT_NOTIFY_FROM not set" };

  const message = buildPilotNotification(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `authority-pilot-request-${input.requestId}`,
      },
      body: JSON.stringify({
        from,
        to: [input.ownerEmail],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
    if (response.ok) return { status: "sent", detail: `resend ${response.status}` };
    return { status: "failed", detail: `resend http ${response.status}` };
  } catch (error) {
    const name = error instanceof Error ? error.name : "error";
    return { status: "failed", detail: `resend ${name === "TimeoutError" ? "timeout" : "network error"}` };
  }
}
