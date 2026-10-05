import type { Metadata } from "next";

import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Stripe connector — Authority Docs" };

export default function StripeConnectorPage() {
  return (
    <DocsPage title="Stripe" description="A fixed, audited set of operations against Stripe's own API.">
      <DocsSection title="Connection setup">
        <p>
          An admin connects at <code>/app/integrations/stripe</code>: name, Test/Live mode, and a secret key —
          one combined &quot;Save and verify&quot; step that immediately checks the key against Stripe&apos;s
          API before marking the connection verified. A{" "}
          <a href="https://docs.stripe.com/keys#limit-access" target="_blank" rel="noreferrer">
            restricted key
          </a>{" "}
          scoped to only the permissions below is recommended over a full secret key.
        </p>
      </DocsSection>

      <DocsSection title="Supported operations">
        <DocsTable
          headers={["Operation", "Arguments", "Effect", "Approval"]}
          rows={[
            ["stripe.retrieve_payment", "payment_id", "read", "—"],
            ["stripe.retrieve_customer", "customer_id", "read", "—"],
            ["stripe.list_charges", "customer_id", "read", "—"],
            ["stripe.issue_refund", "payment_id, amount_cents", "write", "Always requires approval"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Granted by the key, never used by Authority">
        <p>
          An unrestricted secret key can also create/capture payments, manage customers and subscriptions,
          issue payouts, and change account settings. The connector&apos;s code has no request-building path
          for any of it — a restricted key closes the gap at Stripe&apos;s own level too.
        </p>
      </DocsSection>

      <DocsSection title="One merchant account, many of your customers">
        <p>
          A Stripe connection is one merchant&apos;s own secret key — your business&apos;s Stripe account, not
          a per-end-user credential. Delegate that single connection to as many of your own customers as
          should be able to use it (Settings → the connection → Delegations, or the developer API&apos;s
          connection-delegation calls) — the same organization-owned-connection-plus-delegation model GitHub
          repositories, Slack workspaces and database connections all use. Revoking a delegation stops that
          customer&apos;s access to this connection immediately; it never touches the merchant key itself.
        </p>
        <p>
          Don&apos;t confuse the two &quot;customer&quot; concepts in play: <strong>your</strong> customer is
          who a task runs on behalf of (an Authority concept, scoped by delegation as above).{" "}
          <code>stripe.retrieve_customer</code>&apos;s and <code>stripe.list_charges</code>&apos;s{" "}
          <code>customer_id</code> argument is a <strong>Stripe Customer object ID</strong> — a record inside
          the merchant&apos;s own Stripe account, unrelated to and never derived from your Authority customer
          ID.
        </p>
        <p>
          There is no Stripe Connect support — every connection is one directly-entered secret key for one
          Stripe account, never an OAuth flow onboarding multiple separate merchant accounts. If your product
          needs to act on behalf of many independent Stripe accounts (a true multi-merchant platform), that is
          not implemented today.
        </p>
      </DocsSection>

      <DocsSection title="Resource binding">
        <p>
          <code>payment_id</code>/<code>customer_id</code> identifies the resource a capability binds to — a
          capability authorized for one payment cannot be replayed against a different one (
          <code>RESOURCE_MISMATCH</code>).
        </p>
      </DocsSection>

      <DocsSection title="Current limitations">
        <p>
          Reconciliation for an indeterminate refund is not yet automatic — Stripe&apos;s own idempotency-key
          replay lookup isn&apos;t implemented, so an indeterminate refund always resolves manually today.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
