/**
 * Geometry and copy for the hero-only authority graph (design/frontend-
 * simplification, hero correction round 4: centered diamond composition
 * around the Agent, no footer, tighter edges).
 */

export const VIEWBOX = { width: 700, height: 560 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Narrower than before, and the Agent sits at the viewBox's visual center — not the task card —
// so the whole composition centers correctly inside the hero-visual wrapper.
export const TASK_BOX: Box = { x: 200, y: 20, w: 300, h: 66 };
export const AGENT_BOX: Box = { x: 265, y: 230, w: 170, h: 100 };

export const TASK_LABEL = "TASK #4821";
export const TASK_TEXT = "Refund order and notify user";
export const AGENT_NAME = "customer-ops";

export type ServiceId = "postgres" | "stripe" | "gmail" | "github" | "slack";

export interface ServiceNode {
  id: ServiceId;
  label: string;
  box: Box;
  allowed: boolean;
  lines: string[];
}

// A diamond around the Agent, not a vertical tree: PostgreSQL left, Stripe upper-right, Gmail
// lower-right (all allowed, all 30-50px closer to the Agent than the previous layout), GitHub
// muted at lower-left, Slack muted at lower-right — offset from center, never directly beneath
// the Agent.
export const SERVICES: ServiceNode[] = [
  {
    id: "postgres",
    label: "PostgreSQL",
    box: { x: 80, y: 198, w: 160, h: 64 },
    allowed: true,
    lines: ["Read order #4821"],
  },
  {
    id: "stripe",
    label: "Stripe",
    box: { x: 473, y: 158, w: 175, h: 84 },
    allowed: true,
    lines: ["Read payment", "Issue exact refund"],
  },
  {
    id: "gmail",
    label: "Gmail",
    box: { x: 483, y: 328, w: 165, h: 64 },
    allowed: true,
    lines: ["Email this customer"],
  },
  {
    id: "github",
    label: "GitHub",
    box: { x: 75, y: 350, w: 150, h: 60 },
    allowed: false,
    lines: ["Not needed for this task"],
  },
  {
    id: "slack",
    label: "Slack",
    box: { x: 345, y: 430, w: 150, h: 60 },
    allowed: false,
    lines: ["Outside task scope"],
  },
];
