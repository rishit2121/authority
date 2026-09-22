/**
 * Geometry and copy for the agent-centred radial authority graph.
 *
 * Two concepts are kept distinct:
 *   - a **service node** is a system the agent is wired to (Stripe, Gmail, …)
 *   - a **capability path** is one temporary permission granted to the task
 *
 * They are not 1:1 — Stripe carries two capabilities for this task — so the
 * spotlight cycles over paths while nodes light up if any of their paths are
 * live.
 *
 * Port and edge-start coordinates sit on the agent core's perimeter
 * (`AGENT.coreRadius`), so they must be recomputed if that radius changes.
 */

export const VIEWBOX = { width: 760, height: 620 };

export const AGENT = {
  x: 380,
  y: 300,
  coreRadius: 68,
  haloRadius: 96,
  name: "customer-ops-agent",
  model: "claude-opus-5",
  taskId: "#4821",
};

export const ORBIT_RINGS = [
  { r: 104, dash: "2 4", opacity: 0.35 },
  { r: 185, dash: "3 6", opacity: 0.22 },
  { r: 280, dash: "4 8", opacity: 0.15 },
];

export const GRAPH_COLORS = {
  allow: "#42e7a5",
  edge: "#55d8ff",
  dormant: "#3d494d",
  muted: "#869398",
  fade: "#b8707a",
  text: "#dfe2ec",
  nodeFill: "#0b111b",
  scopeFill: "#0e1623",
  deepFill: "#070b11",
} as const;

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeLabel {
  /** Full tool call rendered on the edge itself. */
  text: string;
  x: number;
  y: number;
  width: number;
}

export interface ScopeRow {
  text: string;
  /** The single resource the capability actually reaches. */
  granted?: boolean;
}

export interface ScopePanel {
  x: number;
  y: number;
  width: number;
  rows: ScopeRow[];
}

/** A system the agent holds at least one capability for. */
export interface ServiceNode {
  id: string;
  service: string;
  /** Tool lines rendered inside the plate, one per capability. */
  tools: string[];
  box: NodeBox;
  /** Resource slice the capabilities terminate at. */
  scope: ScopePanel;
}

export const AUTHORIZED_SERVICES: ServiceNode[] = [
  {
    id: "stripe",
    service: "Stripe",
    tools: ["retrieve_payment", "create_refund"],
    box: { x: 96, y: 108, width: 146, height: 58 },
    scope: {
      x: 90,
      y: 176,
      width: 150,
      rows: [
        { text: "pi_4821 ($149.00)", granted: true },
        { text: "pi_4820 [LOCKED]" },
        { text: "pi_4822 [LOCKED]" },
      ],
    },
  },
  {
    id: "gmail",
    service: "Gmail",
    tools: ["send_email"],
    box: { x: 520, y: 112, width: 146, height: 46 },
    scope: {
      x: 520,
      y: 178,
      width: 160,
      rows: [{ text: "maya@example.com", granted: true }, { text: "all_contacts [NO ACCESS]" }],
    },
  },
  {
    id: "postgres",
    service: "PostgreSQL",
    tools: ["query_order"],
    box: { x: 96, y: 452, width: 146, height: 46 },
    scope: {
      x: 90,
      y: 512,
      width: 150,
      rows: [
        { text: "order_id = 4821", granted: true },
        { text: "order_id = 4820 [NO ACCESS]" },
        { text: "order_id = 4822 [NO ACCESS]" },
      ],
    },
  },
];

/**
 * The four capabilities this task receives. Order here is the order the
 * spotlight visits them, which follows the real execution order.
 */
export interface CapabilityPath {
  id: string;
  serviceId: string;
  /** Fully qualified call, e.g. `postgres.query_order`. */
  tool: string;
  path: string;
  port: { x: number; y: number };
  label: EdgeLabel;
  /** Plain-language equivalent used in the accessible description. */
  terminatesAt: string;
}

export const CAPABILITY_PATHS: CapabilityPath[] = [
  {
    id: "postgres-query-order",
    serviceId: "postgres",
    tool: "postgres.query_order",
    path: "M 326 342 C 292 382, 268 430, 242 468",
    port: { x: -54, y: 42 },
    label: { text: "postgres.query_order", x: 282, y: 398, width: 132 },
    terminatesAt: "order_id = 4821",
  },
  {
    id: "stripe-retrieve-payment",
    serviceId: "stripe",
    tool: "stripe.retrieve_payment",
    path: "M 314 284 C 286 244, 262 196, 242 156",
    port: { x: -66, y: -16 },
    label: { text: "stripe.retrieve_payment", x: 322, y: 240, width: 144 },
    terminatesAt: "payment pi_4821",
  },
  {
    id: "stripe-create-refund",
    serviceId: "stripe",
    tool: "stripe.create_refund",
    path: "M 336 248 C 310 210, 276 158, 242 128",
    port: { x: -44, y: -52 },
    label: { text: "stripe.create_refund", x: 322, y: 190, width: 128 },
    terminatesAt: "payment pi_4821",
  },
  {
    id: "gmail-send-email",
    serviceId: "gmail",
    tool: "gmail.send_email",
    path: "M 434 259 C 470 228, 496 176, 520 142",
    port: { x: 54, y: -41 },
    label: { text: "gmail.send_email", x: 455, y: 208, width: 118 },
    terminatesAt: "one customer recipient",
  },
];

/** Tools the agent is connected to but receives no task authority for. */
export interface DormantNode {
  id: string;
  service: string;
  box: NodeBox;
  path: string;
  port: { x: number; y: number };
}

export const DORMANT_NODES: DormantNode[] = [
  {
    id: "github",
    service: "GitHub",
    box: { x: 580, y: 282, width: 128, height: 40 },
    path: "M 448 300 L 580 300",
    port: { x: 68, y: 0 },
  },
  {
    id: "salesforce",
    service: "Salesforce",
    box: { x: 572, y: 428, width: 128, height: 40 },
    path: "M 438 335 L 572 444",
    port: { x: 58, y: 35 },
  },
];

/**
 * The out-of-scope call the agent proposes. It is connected and dim like
 * everything else at rest, takes a muted rose tint once the plan is scoped,
 * then fades out — no capability is ever minted for it.
 */
export const UNAUTHORIZED_NODE = {
  id: "slack",
  service: "Slack",
  tool: "send_message",
  box: { x: 312, y: 470, width: 140, height: 44 },
  path: "M 380 368 L 380 470",
  port: { x: 0, y: 68 },
  label: { text: "slack.send_message", x: 380, y: 420, width: 122 },
  reason: "Messaging sits outside the refund task boundary, so no capability is minted.",
} as const;

export const TASK = {
  id: "TASK #4821",
  prompt: "Refund order #4821 and email the customer a confirmation",
} as const;

/** Every service drawn, for the accessible description. */
export const ALL_SERVICE_NAMES = ["Stripe", "Gmail", "PostgreSQL", "GitHub", "Slack", "Salesforce"] as const;
