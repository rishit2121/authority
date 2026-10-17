"use server";

import { headers } from "next/headers";

import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { recordPilotNotification, submitPilotRequest } from "@/lib/pilot/gateway";
import { sendPilotNotification } from "@/lib/pilot/notify";
import {
  clientIpHash,
  PILOT_RATE_LIMITED_MESSAGE,
  PILOT_REQUEST_RECEIVED_MESSAGE,
  pilotRequestSchema,
} from "@/lib/pilot/request";

/**
 * Public pilot request. No account needed. The response never reveals whether
 * the address was already known or what its status is: a new request and a
 * repeat both get the same confirmation.
 */

export interface PilotRequestFormState {
  error?: string;
  success?: string;
  values?: Record<string, string>;
}

const FIELDS = ["name", "email", "company", "building", "usage", "services"] as const;

export async function requestPilotAccessAction(
  _previous: PilotRequestFormState,
  formData: FormData,
): Promise<PilotRequestFormState> {
  const values = Object.fromEntries(
    FIELDS.map((f) => {
      const v = formData.get(f);
      return [f, typeof v === "string" ? v : ""];
    }),
  ) as Record<(typeof FIELDS)[number], string>;

  // Honeypot: real people never fill a field they can't see.
  if (String(formData.get("website") ?? "") !== "") {
    return { success: PILOT_REQUEST_RECEIVED_MESSAGE };
  }

  const parsed = pilotRequestSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", values };
  }

  const h = await headers();
  const ipHash = clientIpHash(h.get("x-forwarded-for"), h.get("x-real-ip"), process.env.PILOT_IP_SALT ?? "");

  let result;
  try {
    result = await submitPilotRequest(parsed.data, ipHash);
  } catch {
    return { error: "We couldn't save your request just now. Please try again in a moment.", values };
  }

  if (result.status === "rate_limited") return { error: PILOT_RATE_LIMITED_MESSAGE, values };
  if (result.status !== "ok" || !result.requestId) {
    return { error: "Check the form and try again.", values };
  }

  // Saved. Notify the owner once, for new requests only; nothing below can
  // fail the request or change the response.
  if (result.isNew && result.ownerEmail) {
    try {
      const base = publicBaseUrl();
      const notification = await sendPilotNotification({
        requestId: result.requestId,
        ownerEmail: result.ownerEmail,
        ...parsed.data,
        dashboardUrl: base ? `${base}/app/pilot?id=${result.requestId}` : null,
      });
      await recordPilotNotification(result.requestId, notification.status, notification.detail);
    } catch {
      // Recording the status is best effort too.
    }
  }

  return { success: PILOT_REQUEST_RECEIVED_MESSAGE };
}
