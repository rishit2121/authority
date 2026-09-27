import { createHmac, timingSafeEqual } from "node:crypto";

/** X-Hub-Signature-256 verification: HMAC-SHA256 over the RAW body, constant-time compare. */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface ParsedWebhook {
  event: string;
  action: string | null;
  installationId: string | null;
  removedRepositoryIds: number[];
}

export function parseWebhook(event: string, rawBody: string): ParsedWebhook | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as {
    action?: unknown;
    installation?: { id?: unknown };
    repositories_removed?: Array<{ id?: unknown }>;
  };
  const id = b.installation?.id;
  return {
    event,
    action: typeof b.action === "string" && /^[a-z_]{1,60}$/.test(b.action) ? b.action : null,
    installationId: typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? String(id) : null,
    removedRepositoryIds: (b.repositories_removed ?? [])
      .map((r) => r.id)
      .filter((v): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0),
  };
}
