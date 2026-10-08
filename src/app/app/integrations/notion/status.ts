export type NotionDisplayStatus =
  "setup_incomplete" | "unverified" | "verified" | "needs_attention" | "suspended" | "disconnected";

export const DISPLAY_STATUS_LABEL: Record<NotionDisplayStatus, string> = {
  setup_incomplete: "Setup incomplete",
  unverified: "Not verified",
  verified: "Verified",
  needs_attention: "Needs attention",
  suspended: "Suspended",
  disconnected: "Disconnected",
};

export const DISPLAY_STATUS_STYLE: Record<NotionDisplayStatus, string> = {
  setup_incomplete: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
  unverified: "border-secondary/40 bg-secondary/10 text-secondary",
  verified: "border-allow/30 bg-allow/10 text-allow",
  needs_attention: "border-deny/40 bg-deny/10 text-deny",
  suspended: "border-secondary/40 bg-secondary/10 text-secondary",
  disconnected: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export interface NotionConnectionRow {
  id: string;
  name: string;
  hasSecret: boolean;
  lastVerifiedAt: string | null;
  displayStatus: NotionDisplayStatus;
}

export function toDisplayStatus(
  dbStatus: string,
  hasSecret: boolean,
  lastVerifiedAt: string | null,
): NotionDisplayStatus {
  if (dbStatus === "disconnected") return "disconnected";
  if (!hasSecret) return "setup_incomplete";
  if (!lastVerifiedAt) return "unverified";
  if (dbStatus === "active") return "verified";
  if (dbStatus === "suspended") return "suspended";
  return "needs_attention";
}
