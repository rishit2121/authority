import "server-only";

import { gatewayQuery } from "@/lib/gateway/db";

import type { PilotNotificationStatus } from "./notify";
import type { PilotRequestInput } from "./request";

/** Gateway-role calls for the public request form and the sign-up pre-check. */

export type PilotSubmitStatus = "ok" | "rate_limited" | "invalid_request";

export interface PilotSubmitResult {
  status: PilotSubmitStatus;
  requestId: string | null;
  isNew: boolean;
  ownerEmail: string | null;
}

export async function submitPilotRequest(
  input: PilotRequestInput,
  ipHash: string,
): Promise<PilotSubmitResult> {
  const rows = await gatewayQuery<{
    spr_status: PilotSubmitStatus;
    spr_request_id: string | null;
    spr_is_new: boolean;
    spr_owner_email: string | null;
  }>(`select * from gateway.submit_pilot_request($1, $2, $3, $4, $5, $6, $7)`, [
    input.name,
    input.email,
    input.company,
    input.building,
    input.usage,
    input.services,
    ipHash,
  ]);
  const row = rows[0];
  return {
    status: row?.spr_status ?? "invalid_request",
    requestId: row?.spr_request_id ?? null,
    isNew: row?.spr_is_new ?? false,
    ownerEmail: row?.spr_owner_email ?? null,
  };
}

export async function recordPilotNotification(
  requestId: string,
  status: PilotNotificationStatus,
  detail: string,
): Promise<void> {
  await gatewayQuery(`select gateway.record_pilot_notification($1::uuid, $2, $3)`, [
    requestId,
    status,
    detail,
  ]);
}

/** May this address create an account right now? True when the gate is off. */
export async function pilotSignupAllowed(email: string): Promise<boolean> {
  const rows = await gatewayQuery<{ allowed: boolean }>(
    `select gateway.pilot_signup_allowed($1) as allowed`,
    [email],
  );
  return rows[0]?.allowed === true;
}
