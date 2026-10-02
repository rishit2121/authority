import { TASK_TEXT } from "./hero-graph-data";

/** Screen-reader-only narrative of the hero graph's sequence. */
export function HeroGraphDescription() {
  return (
    <p id="hero-graph-description" className="sr-only">
      Diagram: the agent receives the task &ldquo;{TASK_TEXT}&rdquo;. Authority grants the minimum scope
      needed: read the order from PostgreSQL, read the payment and issue an exact refund in Stripe, and email
      the customer through Gmail. GitHub is connected but stays inactive — this task does not need it. A
      proposed Slack message is outside the task&rsquo;s scope and is denied; its connection stops at the
      authority boundary and never reaches Slack. When the task completes, every temporary permission is
      revoked at once.
    </p>
  );
}
