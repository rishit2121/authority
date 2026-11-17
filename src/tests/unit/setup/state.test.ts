import { describe, expect, it } from "vitest";

import {
  connectionSetupState,
  connectionUsableBySetupCustomer,
  describeAccess,
  liveOutcomeLabel,
  READ_CALLS,
  readCallFor,
  recordedCallLabel,
  setupCustomerExternalId,
  summarizeReadData,
  verificationLabel,
  type AccessFacts,
} from "@/lib/setup/state";

const active = { status: "active", hasCredential: true, usableBySetupCustomer: true };

describe("connectionSetupState", () => {
  it("is not connected without a live row", () => {
    expect(connectionSetupState(null)).toBe("not_connected");
    expect(connectionSetupState({ ...active, status: "disconnected" })).toBe("not_connected");
  });

  it("needs consent when no credential is stored yet (a Gmail row before Google consent)", () => {
    expect(connectionSetupState({ ...active, hasCredential: false })).toBe("needs_consent");
    // Even when shared with everyone: no credential is never "ready".
    expect(connectionSetupState({ ...active, hasCredential: false, usableBySetupCustomer: true })).toBe(
      "needs_consent",
    );
  });

  it("is ready only when active, credentialed and usable by the setup customer", () => {
    expect(connectionSetupState(active)).toBe("ready");
  });

  it("needs access when active and credentialed but not usable by the setup customer", () => {
    expect(connectionSetupState({ ...active, usableBySetupCustomer: false })).toBe("needs_access");
  });

  it("needs reconnect when suspended, drifted or expired, before anything else", () => {
    expect(connectionSetupState({ ...active, status: "suspended" })).toBe("needs_reconnect");
    expect(connectionSetupState({ ...active, status: "needs_attention" })).toBe("needs_reconnect");
    expect(connectionSetupState({ ...active, status: "permission_drift" })).toBe("needs_reconnect");
    expect(connectionSetupState({ ...active, status: "expired" })).toBe("needs_reconnect");
    expect(connectionSetupState({ ...active, healthReasons: ["PERMISSION_MISSING:bot_token"] })).toBe(
      "needs_reconnect",
    );
    expect(connectionSetupState({ ...active, healthReasons: ["TOKEN_EXPIRED"] })).toBe("needs_reconnect");
    expect(
      connectionSetupState({
        ...active,
        status: "suspended",
        hasCredential: false,
        usableBySetupCustomer: false,
      }),
    ).toBe("needs_reconnect");
  });

  it("treats an unknown status as broken, never as ready", () => {
    expect(connectionSetupState({ ...active, status: "something_new" })).toBe("needs_reconnect");
  });
});

describe("verificationLabel", () => {
  it("never calls a configured connection verified", () => {
    expect(verificationLabel(null)).toBe("not verified yet");
    expect(verificationLabel(undefined)).toBe("not verified yet");
    expect(verificationLabel("not a date")).toBe("not verified yet");
    expect(verificationLabel("2026-11-01T09:30:00Z")).toBe("last verified 2026-11-01 09:30 UTC");
  });
});

const org = (over: Partial<AccessFacts> = {}): AccessFacts => ({
  ownerKind: "organization",
  ownerCustomerId: null,
  scope: null,
  delegatedCustomerIds: [],
  ...over,
});

describe("connectionUsableBySetupCustomer", () => {
  it("mirrors gateway.connection_usable_by_customer", () => {
    expect(connectionUsableBySetupCustomer(org(), "c1")).toBe(false);
    expect(connectionUsableBySetupCustomer(org({ scope: "admin_only" }), "c1")).toBe(false);
    expect(connectionUsableBySetupCustomer(org({ scope: "backend_grantable" }), "c1")).toBe(false);
    expect(connectionUsableBySetupCustomer(org({ delegatedCustomerIds: ["c2"] }), "c1")).toBe(false);
    expect(connectionUsableBySetupCustomer(org({ delegatedCustomerIds: ["c1"] }), "c1")).toBe(true);
    expect(connectionUsableBySetupCustomer(org({ scope: "application_shared" }), "c1")).toBe(true);
  });

  it("a setup customer that does not exist yet has access only through an app-wide share", () => {
    expect(connectionUsableBySetupCustomer(org({ delegatedCustomerIds: ["c1"] }), null)).toBe(false);
    expect(connectionUsableBySetupCustomer(org({ scope: "application_shared" }), null)).toBe(true);
  });

  it("a customer-owned connection is usable only by its owner", () => {
    const owned = org({ ownerKind: "customer", ownerCustomerId: "c9", scope: "application_shared" });
    expect(connectionUsableBySetupCustomer(owned, "c1")).toBe(false);
    expect(connectionUsableBySetupCustomer(owned, "c9")).toBe(true);
    expect(connectionUsableBySetupCustomer(owned, null)).toBe(false);
  });
});

describe("describeAccess", () => {
  it("says who can use the connection in plain words", () => {
    expect(describeAccess(org(), "Acme").text).toBe("Only admins (no customers yet)");
    expect(describeAccess(org({ scope: "admin_only" }), "Acme").text).toBe("Only admins (no customers yet)");
    expect(describeAccess(org({ delegatedCustomerIds: ["a"] }), "Acme").text).toBe(
      "Shared with 1 specific customer",
    );
    expect(describeAccess(org({ delegatedCustomerIds: ["a", "b", "c"] }), "Acme").text).toBe(
      "Shared with 3 specific customers",
    );
    expect(describeAccess(org({ scope: "backend_grantable" }), "Acme").text).toBe(
      "Your backend may grant it per customer",
    );
    expect(
      describeAccess(org({ scope: "backend_grantable", delegatedCustomerIds: ["a", "b"] }), "Acme").text,
    ).toBe("Shared with 2 specific customers; your backend may grant it per customer");
    expect(
      describeAccess(org({ scope: "application_shared", delegatedCustomerIds: ["a"] }), "Acme").text,
    ).toBe("Every customer of Acme");
    expect(describeAccess(org({ ownerKind: "customer", ownerCustomerId: "a" }), "Acme").kind).toBe(
      "customer_owned",
    );
  });
});

describe("read calls", () => {
  it("has a fixed, argument-free read only for Gmail and Slack", () => {
    expect(readCallFor("gmail")?.tool).toBe("gmail.list_labels");
    expect(readCallFor("slack")?.tool).toBe("slack.list_channels");
    for (const id of ["github", "notion", "linear", "stripe", "custom_abc", "postgres_x", "slackx"]) {
      expect(readCallFor(id)).toBeNull();
    }
  });

  it("summarizes data as a count only", () => {
    expect(summarizeReadData(READ_CALLS.gmail, { labels: new Array(12).fill({ name: "secret" }) })).toBe(
      "12 labels",
    );
    expect(summarizeReadData(READ_CALLS.slack, { channels: [{ name: "general" }] })).toBe("1 channel");
    expect(summarizeReadData(READ_CALLS.slack, { channels: [] })).toBe("0 channels");
    expect(summarizeReadData(READ_CALLS.slack, null)).toBeNull();
    expect(summarizeReadData(READ_CALLS.slack, { other: [] })).toBeNull();
    expect(summarizeReadData(READ_CALLS.slack, "general")).toBeNull();
  });

  it("names the setup customer by user id", () => {
    expect(setupCustomerExternalId("u-1")).toBe("authority-setup-u-1");
  });
});

describe("labels", () => {
  it("labels every live outcome in text", () => {
    expect(liveOutcomeLabel("executed").text).toBe("Allowed");
    expect(liveOutcomeLabel("blocked_before_dispatch").text).toBe("Blocked before dispatch");
    expect(liveOutcomeLabel("result_held").text).toBe("Result held");
    expect(liveOutcomeLabel("indeterminate").text).toBe("Outcome unknown");
    expect(liveOutcomeLabel("needs_access").text).toBe("Needs access");
    expect(liveOutcomeLabel("not_ready", "awaiting_approval").text).toBe("Not ready (awaiting_approval)");
    expect(liveOutcomeLabel("failed").text).toBe("Failed");
  });

  it("rebuilds the label from the recorded decision and receipt", () => {
    expect(recordedCallLabel({ decisionOutcome: null, receiptResult: null }).text).toBe(
      "No call recorded yet",
    );
    expect(recordedCallLabel({ decisionOutcome: "deny", receiptResult: null }).text).toBe(
      "Blocked before dispatch",
    );
    expect(recordedCallLabel({ decisionOutcome: "require_approval", receiptResult: null }).text).toBe(
      "Blocked before dispatch",
    );
    expect(recordedCallLabel({ decisionOutcome: "allow", receiptResult: "succeeded" })).toEqual({
      text: "Allowed",
      tone: "positive",
    });
    expect(
      recordedCallLabel({ decisionOutcome: "allow_constrained", receiptResult: "indeterminate" }).text,
    ).toBe("Outcome unknown");
    expect(recordedCallLabel({ decisionOutcome: "allow", receiptResult: "failed" }).tone).toBe("negative");
    expect(recordedCallLabel({ decisionOutcome: "allow", receiptResult: null }).tone).toBe("neutral");
  });
});
