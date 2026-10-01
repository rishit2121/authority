import { TASK_TEXT } from "./graph-data";

/**
 * Screen-reader-only narrative of what the animation shows, so the meaning
 * survives even when the visual sequence can't be perceived.
 */
export function ScopeGraphDescription() {
  return (
    <p id="scope-graph-description" className="sr-only">
      Diagram: the agent receives the task &ldquo;{TASK_TEXT}&rdquo; and proposes a plan. Authority computes
      the minimum scope needed: read the order from PostgreSQL, read the payment and create a refund for the
      exact approved amount in Stripe, and email the customer through Gmail. A proposed Slack message is not
      required for this task and is denied — its connection stops at the authority boundary and never reaches
      Slack. The four required actions are allowed, shown in green. When the task completes, every temporary
      permission is revoked at once. Zero standing permissions remain.
    </p>
  );
}
