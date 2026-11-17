/**
 * Pure rules behind the guided Setup page (src/app/app/setup): what state one connection is in for the setup
 * customer, who can use it today in plain words, and which connectors have a fixed read call to try. No database
 * or server-only imports, so every rule is unit-tested on its own (src/tests/unit/setup/state.test.ts).
 */

import type { Database } from "@/lib/supabase/database.types";

export type AccessScope = Database["public"]["Enums"]["application_access_scope"];

/** The setup customer for one dashboard user: a customer of the chosen application, never a real end user. */
export function setupCustomerExternalId(userId: string): string {
  return `authority-setup-${userId}`;
}

export const SETUP_AGENT_FRAMEWORK = "authority-setup";
export const SETUP_AGENT_NAME = "Setup agent";
/** Every task the Setup page creates has an idempotency key with this prefix. */
export const SETUP_TASK_KEY_PREFIX = "setup-";

export type ConnectionSetupState =
  "not_connected" | "needs_consent" | "ready" | "needs_access" | "needs_reconnect";

export const CONNECTION_STATE_LABEL: Record<ConnectionSetupState, string> = {
  not_connected: "Not connected",
  needs_consent: "Needs consent",
  ready: "Ready for this customer",
  needs_access: "Needs access",
  needs_reconnect: "Needs reconnect",
};

export interface SetupConnectionFacts {
  /** connector_connections.status: active | suspended | needs_attention | disconnected. */
  status: string;
  /** connector_connections.health_reasons, from the connector's own last verification. */
  healthReasons?: readonly string[];
  /** A stored credential exists (an OAuth refresh token, a bot token, an API key...). */
  hasCredential: boolean;
  /** `connectionUsableBySetupCustomer(...)` for the chosen application. */
  usableBySetupCustomer: boolean;
}

/** Health reasons a connector's own verification records when the credential stopped working. */
const RECONNECT_REASON = /(PERMISSION_|DRIFT|EXPIRED|REVOKED|REVERIFICATION)/i;

/**
 * One connection's state for the setup customer. Order matters: a connection that is gone or broken is never
 * reported as merely lacking access, and one with no credential yet is never "ready" however it is shared.
 * "Ready" means configured and usable -- it does not mean verified (see `verificationLabel`).
 */
export function connectionSetupState(connection: SetupConnectionFacts | null): ConnectionSetupState {
  if (!connection || connection.status === "disconnected") return "not_connected";
  if (
    connection.status === "suspended" ||
    connection.status === "needs_attention" ||
    connection.status === "permission_drift" ||
    connection.status === "expired" ||
    (connection.healthReasons ?? []).some((reason) => RECONNECT_REASON.test(reason))
  ) {
    return "needs_reconnect";
  }
  if (connection.status !== "active") return "needs_reconnect";
  if (!connection.hasCredential) return "needs_consent";
  return connection.usableBySetupCustomer ? "ready" : "needs_access";
}

/** "Configured" is never shown as "verified". */
export function verificationLabel(lastVerifiedAt: string | null | undefined): string {
  if (!lastVerifiedAt) return "not verified yet";
  const date = new Date(lastVerifiedAt);
  if (Number.isNaN(date.getTime())) return "not verified yet";
  return `last verified ${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface AccessFacts {
  ownerKind: string;
  ownerCustomerId: string | null;
  /** This application's policy for this connection; null when no row exists (the admin-only default). */
  scope: AccessScope | null;
  /** Customers of THIS application with a live (unrevoked) delegation of this connection. */
  delegatedCustomerIds: readonly string[];
}

/**
 * Mirrors gateway.connection_usable_by_customer (migration 20261003000021) for display only. The server
 * re-checks on every task creation and prepare; this never authorizes anything. A setup customer that does not
 * exist yet is usable only through an application-wide share.
 */
export function connectionUsableBySetupCustomer(facts: AccessFacts, setupCustomerId: string | null): boolean {
  if (facts.ownerKind === "customer") {
    return setupCustomerId !== null && facts.ownerCustomerId === setupCustomerId;
  }
  if (facts.ownerKind !== "organization") return false;
  if (facts.scope === "application_shared") return true;
  return setupCustomerId !== null && facts.delegatedCustomerIds.includes(setupCustomerId);
}

export type AccessKind =
  "customer_owned" | "application_shared" | "specific_customers" | "backend" | "admins";

/** Who can use this connection today, for this application, in the words the access UI already uses. */
export function describeAccess(facts: AccessFacts, appName: string): { kind: AccessKind; text: string } {
  if (facts.ownerKind === "customer") {
    return { kind: "customer_owned", text: "Owned by one customer (their own account)" };
  }
  if (facts.scope === "application_shared") {
    return { kind: "application_shared", text: `Every customer of ${appName}` };
  }
  const n = facts.delegatedCustomerIds.length;
  if (n > 0) {
    const shared = `Shared with ${n} specific customer${n === 1 ? "" : "s"}`;
    return {
      kind: "specific_customers",
      text:
        facts.scope === "backend_grantable" ? `${shared}; your backend may grant it per customer` : shared,
    };
  }
  if (facts.scope === "backend_grantable") {
    return { kind: "backend", text: "Your backend may grant it per customer" };
  }
  return { kind: "admins", text: "Only admins (no customers yet)" };
}

export interface ReadCall {
  connectorId: "gmail" | "slack";
  tool: string;
  operation: string;
  /** The env var the hand-off code reads the connection id from. A connection id is not a secret. */
  envVar: string;
  intent: string;
  request: string;
  dataKey: string;
  noun: [singular: string, plural: string];
}

/** Connectors with a fixed, argument-free read call the Setup page may make. Everything else has none. */
export const READ_CALLS: Record<"gmail" | "slack", ReadCall> = {
  gmail: {
    connectorId: "gmail",
    tool: "gmail.list_labels",
    operation: "list_labels",
    envVar: "GMAIL_CONNECTION_ID",
    intent: "Setup check: list the labels in the connected Gmail account",
    request: "List the labels in my Gmail account",
    dataKey: "labels",
    noun: ["label", "labels"],
  },
  slack: {
    connectorId: "slack",
    tool: "slack.list_channels",
    operation: "list_channels",
    envVar: "SLACK_CONNECTION_ID",
    intent: "Setup check: list the channels in the connected Slack workspace",
    request: "List the channels in our Slack workspace",
    dataKey: "channels",
    noun: ["channel", "channels"],
  },
};

export function readCallFor(connectorId: string): ReadCall | null {
  return connectorId === "gmail" || connectorId === "slack" ? READ_CALLS[connectorId] : null;
}

/** A count only ("12 labels"): the Setup page never shows provider content. */
export function summarizeReadData(call: ReadCall, data: unknown): string | null {
  if (data === null || data === undefined || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[call.dataKey];
  if (!Array.isArray(value)) return null;
  const n = value.length;
  return `${n} ${n === 1 ? call.noun[0] : call.noun[1]}`;
}

/** How each connector actually connects, shown on its card. */
export const CONNECTOR_IDENTITY: Record<string, string> = {
  gmail: "Google account consent (OAuth)",
  slack: "Workspace bot token",
  github: "GitHub App installation",
};

export type CallTone = "positive" | "negative" | "attention" | "neutral";

/** A text label for the live result of "Make a protected call" -- never color alone. */
export function liveOutcomeLabel(
  outcome: string,
  preparedStatus?: string | null,
): { text: string; tone: CallTone } {
  switch (outcome) {
    case "executed":
      return { text: "Allowed", tone: "positive" };
    case "blocked_before_dispatch":
      return { text: "Blocked before dispatch", tone: "negative" };
    case "result_held":
      return { text: "Result held", tone: "attention" };
    case "indeterminate":
      return { text: "Outcome unknown", tone: "attention" };
    case "needs_access":
      return { text: "Needs access", tone: "attention" };
    case "not_ready":
      return { text: `Not ready (${preparedStatus ?? "unknown"})`, tone: "attention" };
    default:
      return { text: "Failed", tone: "negative" };
  }
}

/**
 * The same label, rebuilt after a refresh from what the database recorded for a setup task: its latest
 * authorization decision and connector receipt (RLS-scoped). A held result is not recorded there, so after a
 * refresh such a call shows as "Allowed" with its receipt.
 */
export function recordedCallLabel(record: { decisionOutcome: string | null; receiptResult: string | null }): {
  text: string;
  tone: CallTone;
} {
  if (!record.decisionOutcome) return { text: "No call recorded yet", tone: "neutral" };
  const allowed = record.decisionOutcome === "allow" || record.decisionOutcome === "allow_constrained";
  if (!allowed) return { text: "Blocked before dispatch", tone: "negative" };
  switch (record.receiptResult) {
    case "succeeded":
    case "succeeded_noop":
      return { text: "Allowed", tone: "positive" };
    case "indeterminate":
      return { text: "Outcome unknown", tone: "attention" };
    case "failed":
    case "released":
      return { text: "Allowed; provider call failed", tone: "negative" };
    default:
      return { text: "Allowed; no receipt yet", tone: "neutral" };
  }
}
