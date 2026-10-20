import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";
import { FINDING_HELP } from "@/lib/alignment/finding-help";

export const metadata: Metadata = { title: "Task alignment and value checks — Authority Docs" };

export default function TaskAlignmentPage() {
  return (
    <DocsPage
      title="Task alignment and value checks"
      description="An optional layer that asks whether a plan, its values and each call actually serve what the user asked for. It can only hold or stop work -- never allow more than the contract does."
    >
      <DocsSection title="Deterministic enforcement vs. alignment review">
        <p>
          Authority&apos;s <strong>contract</strong> is deterministic: exact tools, pinned argument values,
          budgets, expiry, task sessions. Its answer for a given call is always the same, and alignment never
          changes it.
        </p>
        <p>
          <strong>Alignment review</strong> adds a judgment the contract can&apos;t make: does this plan, with
          these values, serve the user&apos;s request? It is based on Task Shield (Jia et al., ACL 2025).
          Value checks against literals in the request (recipients, ids, amounts, currency) are deterministic;
          everything else is a <strong>model judgment</strong> -- it can be wrong in either direction, and it
          is not a guarantee of protection against prompt injection.
        </p>
      </DocsSection>

      <DocsSection title="Settings (Settings → Applications → your app → Task alignment)">
        <DocsTable
          headers={["Setting", "What it does"]}
          rows={[
            ["Off (default)", "Nothing is reviewed. Existing applications stay Off until you change it."],
            ["Shadow", "Reviews run and findings are recorded on the task page; nothing is held or blocked."],
            [
              "Enforce",
              "A misaligned plan returns alignment_review (revise); an ambiguous or unreviewed one is held; a misaligned call is refused and an uncertain one is held.",
            ],
            ["Policy: Production", "Task Shield scores plus value checks and typed findings (recommended)."],
            ["Policy: Reference", "Task Shield exactly as published, for evaluation."],
            ["Plans and values at prepare", "Reviews the whole plan once, before the contract activates."],
            [
              "Each tool call at authorization",
              "Reviews calls whose values are chosen at run time. A call fully pinned by a cleared plan needs no model call.",
            ],
            [
              "Content screening (optional)",
              "Only for content you submit and Authority's connector results -- see External-content screening.",
            ],
          ]}
        />
        <p>
          Plan and per-call checks need nothing from your code beyond the task&apos;s request: they run inside{" "}
          <code>prepare</code> and <code>/authorize</code>, whether or not you ever submit content.{" "}
          <Link href="/docs/task-sessions#require-task-sessions">Require task sessions</Link> is a separate
          setting and does not change with any of these.
        </p>
      </DocsSection>

      <DocsSection title="What your code sees">
        <DocsTable
          headers={["Where", "Field", "Values"]}
          rows={[
            [
              "prepare",
              "status",
              "ready | awaiting_approval | alignment_review (decision: revise | hold) | clarification | rejected",
            ],
            ["prepare", "checks.planReview", "ran | not_run"],
            ["prepare", "alignment", "{ mode, policy, outcome, decision, reviewId, findings, feedback }"],
            [
              "authorize",
              "checks.taskAlignment",
              "not_run | shadow | passed | covered_by_plan_review | stopped | held",
            ],
            [
              "authorize",
              "reasonCodes",
              "TASK_ALIGNMENT_MISALIGNED (deny) | TASK_ALIGNMENT_HELD | TASK_ALIGNMENT_UNREVIEWED (require_approval)",
            ],
            [
              "SDK tools.execute",
              "status",
              "requires_replan (with alignment.feedback) | held_for_review (with alignment.reviewId)",
            ],
          ]}
        />
        <p>
          &quot;not_run&quot; means the check did not run -- it is never a pass. See{" "}
          <Link href="/docs/approvals-and-replanning">Approvals and replanning</Link> for the revise and retry
          examples.
        </p>
      </DocsSection>

      <DocsSection title="Findings and what to do" id="findings">
        <DocsTable
          headers={["Finding", "Meaning", "Next action", "Basis"]}
          rows={Object.entries(FINDING_HELP).map(([type, h]) => [
            <code key={type}>{type}</code>,
            h.meaning,
            h.next,
            h.basis,
          ])}
        />
      </DocsSection>

      <DocsSection title="When the user's request changes">
        <CodeBlock
          language="javascript"
          code={`// Backend key only -- agents and content can never change what the user asked for.
await backend.tasks.reviseObjectives(taskId, "Refund $7 of payment pi_1 instead.");
const prepared = await backend.tasks.prepare(taskId, { plan }); // reviews against the new objectives`}
        />
      </DocsSection>

      <DocsSection title="Reviewer configuration, cost and failure behavior">
        <DocsTable
          headers={["Environment variable", "Purpose"]}
          rows={[
            [
              "OPENAI_API_KEY",
              'Required for any review. Without it, every review is "unreviewed" (held under Enforce).',
            ],
            ["OPENAI_MODEL", "Reviewer model (default gpt-6-luna). Strict structured outputs are required."],
            ["ALIGNMENT_REVIEW_TIMEOUT_MS", "Per-call timeout (default 20000, max 60000)."],
            [
              "ALIGNMENT_MAX_REVIEWER_CALLS / _TOKENS",
              "Optional hard cap for the server process; beyond it reviews are unreviewed.",
            ],
          ]}
        />
        <p>
          Rough cost per task: one call to extract the user&apos;s objectives, one per plan review, one per
          call whose values are chosen at run time, one per screened document. Your OpenAI project&apos;s
          request limits apply (for example 50 requests per day on a low tier).
        </p>
        <p>
          <strong>Failure is never a pass.</strong> Timeouts, quota or budget exhaustion, malformed output and
          an unavailable provider all produce &quot;unreviewed&quot;: under Enforce the plan or call is held
          for a person; under Shadow nothing changes. An authorize call that waits for a review typically
          takes a few seconds.
        </p>
      </DocsSection>

      <DocsSection title="Limits">
        <ul className="list-disc pl-5">
          <li>Model judgments vary between runs and can miss nested or disguised instructions.</li>
          <li>Deterministic value checks only cover values written literally in the request.</li>
          <li>
            Wording requirements on text the agent writes at run time (&quot;two sentences&quot;, &quot;one
            line&quot;, &quot;the same summary&quot;) can&apos;t be judged from a plan, so plan review defers
            them (recorded as an informational finding) and the action check applies them to the actual
            message. Recipients, channels, amounts, prohibitions and disclosures are never deferred.
          </li>
          <li>
            Only what passes through Authority is reviewed: Authority cannot see your model&apos;s other
            context.
          </li>
          <li>
            Our own smoke evaluation is small and is not evidence of production accuracy -- see{" "}
            <Link href="/docs/results-and-evaluation">Results and evaluation</Link>.
          </li>
        </ul>
      </DocsSection>
    </DocsPage>
  );
}
