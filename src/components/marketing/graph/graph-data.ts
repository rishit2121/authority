/**
 * Static geometry and copy for the Phase 1 marketing "scope graph" — a
 * deliberately simplified replacement for the old, denser AuthorityGraph.
 * Kept separate from `src/components/graph/graph-data.ts`, which the
 * Validation Lab's AttackGraph still depends on and which this redesign does
 * not touch.
 */

export const VIEWBOX = { width: 760, height: 560 };

export const TASK_TEXT = "Refund order #4821 and email the customer a confirmation.";

export const AGENT = { x: 380, y: 280, label: "Agent" };

export type ServiceId = "postgres" | "stripe" | "gmail" | "github" | "slack";

export interface ServiceNode {
  id: ServiceId;
  label: string;
  x: number;
  y: number;
  /** Drawn muted — currently only Slack, the one unnecessary tool in this scenario. */
  dim?: boolean;
}

export const SERVICES: ServiceNode[] = [
  { id: "postgres", label: "PostgreSQL", x: 120, y: 100 },
  { id: "stripe", label: "Stripe", x: 640, y: 100 },
  { id: "github", label: "GitHub", x: 120, y: 460 },
  { id: "gmail", label: "Gmail", x: 640, y: 460 },
  // Deliberately drawn dim, per spec, even though it is the one node with an attempted path —
  // the muted styling signals "not really part of this workflow" independent of the attempt.
  { id: "slack", label: "Slack", x: 380, y: 495, dim: true },
];

export interface AuthorityPath {
  id: string;
  service: ServiceId;
  /** Human-readable first. */
  label: string;
  /** Technical operation id, shown smaller and secondary. */
  operationId: string;
  kind: "required" | "rejected";
}

export const PATHS: AuthorityPath[] = [
  {
    id: "read-order",
    service: "postgres",
    label: "Read order #4821",
    operationId: "postgres.select",
    kind: "required",
  },
  {
    id: "read-payment",
    service: "stripe",
    label: "Read payment",
    operationId: "stripe.payment_intents.retrieve",
    kind: "required",
  },
  {
    id: "create-refund",
    service: "stripe",
    label: "Refund the exact amount",
    operationId: "stripe.refunds.create",
    kind: "required",
  },
  {
    id: "email-customer",
    service: "gmail",
    label: "Email the customer",
    operationId: "gmail.messages.send",
    kind: "required",
  },
  {
    id: "slack-message",
    service: "slack",
    label: "Send message",
    operationId: "slack.chat.postMessage",
    kind: "rejected",
  },
];

export const REQUIRED_PATHS = PATHS.filter((p) => p.kind === "required");
export const REJECTED_PATHS = PATHS.filter((p) => p.kind === "rejected");
