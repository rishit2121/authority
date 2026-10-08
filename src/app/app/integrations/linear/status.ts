export type LinearDisplayStatus =
  "setup_incomplete" | "unverified" | "verified" | "needs_attention" | "suspended" | "disconnected";

export const DISPLAY_STATUS_LABEL: Record<LinearDisplayStatus, string> = {
  setup_incomplete: "Setup incomplete",
  unverified: "Not verified",
  verified: "Verified",
  needs_attention: "Needs attention",
  suspended: "Suspended",
  disconnected: "Disconnected",
};

export const DISPLAY_STATUS_STYLE: Record<LinearDisplayStatus, string> = {
  setup_incomplete: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
  unverified: "border-secondary/40 bg-secondary/10 text-secondary",
  verified: "border-allow/30 bg-allow/10 text-allow",
  needs_attention: "border-deny/40 bg-deny/10 text-deny",
  suspended: "border-secondary/40 bg-secondary/10 text-secondary",
  disconnected: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export interface LinearConnectionRow {
  id: string;
  name: string;
  hasSecret: boolean;
  lastVerifiedAt: string | null;
  displayStatus: LinearDisplayStatus;
}

export function toDisplayStatus(
  dbStatus: string,
  hasSecret: boolean,
  lastVerifiedAt: string | null,
): LinearDisplayStatus {
  if (dbStatus === "disconnected") return "disconnected";
  if (!hasSecret) return "setup_incomplete";
  if (!lastVerifiedAt) return "unverified";
  if (dbStatus === "active") return "verified";
  if (dbStatus === "suspended") return "suspended";
  return "needs_attention";
}
