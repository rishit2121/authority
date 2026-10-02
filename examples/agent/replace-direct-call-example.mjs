/**
 * Shows the one-line-of-reasoning change that matters: replacing a tool
 * function that calls a provider directly with one that calls Authority
 * instead. Nothing else about how your agent framework invokes tool
 * functions needs to change -- the function signature (name in, result out)
 * is the same; only what's inside it is different.
 */
import { createAuthorityClient } from "./authority-client.mjs";

// -----------------------------------------------------------------------
// BEFORE: a typical tool function, called by your agent framework's own
// tool-calling loop. It has Stripe's real secret key in scope and can
// construct ANY Stripe request -- there is nothing stopping it from
// calling a completely different endpoint than the one it's named for.
// -----------------------------------------------------------------------
//
// async function retrievePayment({ payment_id }) {
//   const res = await fetch(`https://api.stripe.com/v1/payment_intents/${payment_id}`, {
//     headers: { authorization: `Basic ${Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString("base64")}` },
//   });
//   return res.json();
// }

// -----------------------------------------------------------------------
// AFTER: the same function name and signature, called by your framework
// exactly the same way -- but it never sees a Stripe credential, and it
// cannot construct an arbitrary request. It only ever asks Authority for
// this one named operation; Authority decides whether the task's contract
// allows it, and if so, builds and sends the real Stripe request itself.
// -----------------------------------------------------------------------

const authority = createAuthorityClient({
  baseUrl: process.env.AUTHORITY_URL,
  runtimeKey: process.env.AUTHORITY_RUNTIME_KEY,
});

export async function retrievePayment({ payment_id }, { taskId }) {
  const outcome = await authority.call({
    taskId,
    tool: "stripe.retrieve_payment",
    operation: "retrieve_payment",
    arguments: { payment_id },
    resource: payment_id,
  });
  switch (outcome.kind) {
    case "done":
      return outcome.data;
    case "wait_for_approval":
      return { pending_approval: true, statusUrl: outcome.statusUrl };
    default:
      // Denied, requires replanning, or a temporary condition -- never silently retried or ignored.
      return { denied: true, reason: outcome.kind, message: outcome.message };
  }
}
