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
