import "server-only";

import type { RegistryData } from "../types";

/**
 * The audited demo/test registry. Provider-neutral in shape, GitHub-flavored
 * in content, matching the examples in the Part 3A specification, plus one
 * Gmail-style operation solely to exercise the external-communication rule.
 *
 * Deliberately includes overlapping coverage so the solver has a real choice
 * to make, not a single obviously-correct answer:
 *
 *  - `issues_read` vs `repo_read`: for a plan needing only `get_issue`,
 *    `repo_read` also exposes `read_repository`, which is not required — an
 *    excess operation, so `issues_read` wins on the *first* objective tier
 *    alone. For a plan needing both `get_issue` and `read_repository`,
 *    neither exposes an excess operation, and `repo_read` (one permission,
 *    combined risk 2) beats `issues_read` + `repository_read` (two
 *    permissions, combined risk 1 + 2 = 3) on the second tier — the broad
 *    permission is objectively minimal here, not merely convenient.
 *  - `contents_write` vs `branches_write` + `commits_write`: covers the same
 *    two operations with zero excess either way, but the narrow combination
 *    (risk 2 + 2 = 4) beats the single broad permission (risk 5) on the
 *    second tier — two narrow scopes beating one broader scope specifically
 *    because the broad one costs more, not because narrow always wins.
 *  - `issues_read` vs `issues_read_alt`: identical coverage and cost under
 *    every tier, included specifically to exercise the deterministic
 *    permission-ID tie-break when two solutions are otherwise equally
 *    optimal.
 *  - `get_repository_secrets` is covered only by `secrets_read` (high risk)
 *    and the catch-all `repo_admin` — neither is ever a legitimate solver
 *    choice for the demo issue-resolution task, which never requires this
 *    operation; the plan validator rejects any candidate plan that includes
 *    it outright (see plan-validator.ts), so the solver never even sees it
 *    as a required operation in the demo scenario.
 *  - `gmail.send_email` is the only operation with `externalCommunication:
 *    true` — included purely to exercise that rule, unrelated to the GitHub
 *    scenario otherwise.
 *  - `stripe.issue_refund` is the only operation with `financialImpact:
 *    true` — included purely to exercise Part 3B's approval-rule deriver,
 *    unrelated to the GitHub scenario otherwise.
 *  - `github.delete_branch` is the only operation with `sideEffect:
 *    "write_delete"` — included purely to exercise the approval-rule
 *    deriver's irreversible-operation rule, since deleting a branch is the
 *    one destructive action a real issue-resolution task could plausibly
 *    need.
 *
 * Despite the name, this is now the one base registry fixture merged into
 * every tenant's compiled registry (see tenant.ts), not GitHub-fixture-only
 * content — `stripe.retrieve_payment`, `stripe.retrieve_customer`, and
 * `stripe.list_charges` (Phase 6 of the agent-integration roadmap) sit
 * alongside the original `stripe.issue_refund` demo operation for exactly
 * this reason: a real `AuthorityConnector` now exists for everything with a
 * "stripe." prefix (src/lib/connectors/stripe/connector.ts), so this one
 * demo operation became a real, executable one without changing its id or
 * shape. `slack.post_message` and `slack.list_channels` (Phase 8) are new
 * operations with a real connector behind them from the start
 * (src/lib/connectors/slack/connector.ts). `gmail.send_email` (Phase 7) is
 * the same demo-operation-becomes-real-operation story as Stripe's refund:
 * its real connector (src/lib/connectors/gmail/connector.ts) uses `to` as
 * the resource a capability binds against, so `to.identifiesResource` was
 * flipped from `false` to `true` here, and an optional `body` field was
 * added — neither changes any existing test's outcome (`externalCommunication:
 * true` already forces `requires_review` unconditionally, before
 * `identifiesResource` is ever consulted). Renaming this file is a separate
 * cleanup, deferred to avoid touching
 * `src/tests/integration/gateway-support.ts`'s regex read of this exact path
 * for `registryVersion`. `gmail.list_messages`, `gmail.get_message`, and
 * `gmail.list_labels` were added alongside `gmail.send_email` once the
 * Gmail connector's own OAuth grant widened from `gmail.send`-only to full
 * mailbox access (src/lib/connectors/gmail/oauth.ts) — the broader grant on
 * its own authorizes nothing; these three new, individually-audited read
 * operations are what actually make any of that access callable.
 */
export const githubDemoRegistry: RegistryData = {
  schemaVersion: 1,
  registryVersion: "github-demo-2026-10-02d",
  operations: [
    {
      id: "github.get_issue",
      provider: "github",
      sideEffect: "read",
      resourceType: "issue",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [{ key: "issue_number", type: "string", required: true, identifiesResource: true }],
      preconditions: ["The repository must already exist and be bound to the task."],
      effects: ["Returns issue title, body and metadata; makes no change to the repository."],
      alternativeOperationIds: [],
    },
    {
      id: "github.get_pull_request",
      provider: "github",
      sideEffect: "read",
      resourceType: "pull_request",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [{ key: "pull_number", type: "string", required: true, identifiesResource: true }],
      preconditions: ["The repository must already exist and be bound to the task."],
      effects: [
        "Returns pull request title, body, status and diff metadata; makes no change to the repository.",
      ],
      alternativeOperationIds: [],
    },
    {
      id: "github.read_repository",
      provider: "github",
      sideEffect: "read",
      resourceType: "repository",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [{ key: "repository", type: "string", required: true, identifiesResource: true }],
      preconditions: ["The repository must already exist and be bound to the task."],
      effects: ["Returns repository metadata (default branch, visibility, description); makes no change."],
      alternativeOperationIds: [],
    },
    {
      id: "github.create_branch",
      provider: "github",
      sideEffect: "write_create",
      resourceType: "branch",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [
        { key: "repository", type: "string", required: true, identifiesResource: true },
        { key: "branch", type: "string", required: true, identifiesResource: false },
      ],
      preconditions: [
        "The repository must already exist and be bound to the task.",
        "The branch name must not be the repository's default branch.",
      ],
      effects: [
        "Creates a new branch pointing at the current head of the source branch; the source branch is unchanged.",
      ],
      alternativeOperationIds: [],
    },
    {
      id: "github.push_commit",
      provider: "github",
      sideEffect: "write_update",
      resourceType: "commit",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [
        { key: "repository", type: "string", required: true, identifiesResource: true },
        { key: "branch", type: "string", required: true, identifiesResource: false },
      ],
      preconditions: [
        "The target branch must already exist and must not be the repository's default branch.",
      ],
      effects: ["Adds one or more commits to the target branch; no other branch is affected."],
      alternativeOperationIds: ["github.put_file"],
    },
    {
      id: "github.put_file",
      provider: "github",
      sideEffect: "write_update",
      resourceType: "file",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [
        { key: "repository", type: "string", required: true, identifiesResource: true },
        { key: "branch", type: "string", required: true, identifiesResource: false },
        { key: "path", type: "string", required: true, identifiesResource: false },
      ],
      preconditions: [
        "The target branch must already exist and must not be the repository's default branch.",
      ],
      effects: ["Creates or replaces exactly one file's contents on the target branch as a new commit."],
      alternativeOperationIds: ["github.push_commit"],
    },
    {
      id: "github.create_pull_request",
      provider: "github",
      sideEffect: "write_create",
      resourceType: "pull_request",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [
        { key: "repository", type: "string", required: true, identifiesResource: true },
        { key: "target_branch", type: "string", required: true, identifiesResource: false },
        { key: "head_branch", type: "string", required: false, identifiesResource: false },
      ],
      preconditions: [
        "The head branch must already exist and differ from the target branch.",
        "The target branch is typically the repository's default branch.",
      ],
      effects: [
        "Opens a pull request proposing to merge the head branch into the target branch; merges nothing by itself.",
      ],
      alternativeOperationIds: [],
    },
    {
      id: "github.delete_branch",
      provider: "github",
      sideEffect: "write_delete",
      resourceType: "branch",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [
        { key: "repository", type: "string", required: true, identifiesResource: true },
        { key: "branch", type: "string", required: true, identifiesResource: false },
      ],
      preconditions: [
        "The branch must not be the repository's default branch.",
        "The branch should no longer be needed by an open pull request the task created.",
      ],
      effects: ["Permanently removes the branch and its unmerged history from the remote."],
      alternativeOperationIds: [],
    },
    {
      id: "github.get_repository_secrets",
      provider: "github",
      sideEffect: "read",
      resourceType: "secret",
      dataSensitivity: "secret",
      externalCommunication: false,
      requiresApproval: true,
      financialImpact: false,
      argumentFields: [{ key: "repository", type: "string", required: true, identifiesResource: true }],
      preconditions: [
        "Reserved for administrative tasks; a task whose stated objective does not concern repository configuration should not need this.",
      ],
      effects: ["Returns the names (not values) of configured repository secrets."],
      alternativeOperationIds: [],
    },
    {
      id: "gmail.send_email",
      provider: "gmail",
      sideEffect: "write_create",
      resourceType: "email",
      dataSensitivity: "confidential",
      externalCommunication: true,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [
        { key: "to", type: "string", required: true, identifiesResource: true },
        { key: "subject", type: "string", required: true, identifiesResource: false },
        { key: "body", type: "string", required: false, identifiesResource: false },
      ],
      preconditions: [
        "The recipient must be identifiable from the task's own intent or trusted inputs, never invented.",
      ],
      effects: ["Sends one email to the named recipient; this leaves the organization and cannot be undone."],
      alternativeOperationIds: [],
    },
    {
      id: "gmail.list_messages",
      provider: "gmail",
      sideEffect: "read",
      resourceType: "email",
      dataSensitivity: "confidential",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [
        { key: "query", type: "string", required: false, identifiesResource: false },
        { key: "max_results", type: "number", required: false, identifiesResource: false },
      ],
      preconditions: [],
      effects: ["Returns up to 50 matching message ids and snippets from across the connected mailbox."],
      alternativeOperationIds: [],
    },
    {
      id: "gmail.get_message",
      provider: "gmail",
      sideEffect: "read",
      resourceType: "email",
      dataSensitivity: "confidential",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [{ key: "message_id", type: "string", required: true, identifiesResource: true }],
      preconditions: [],
      effects: ["Returns one message's full content, including headers and body."],
      alternativeOperationIds: [],
    },
    {
      id: "gmail.list_labels",
      provider: "gmail",
      sideEffect: "read",
      resourceType: "email",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [],
      preconditions: [],
      effects: ["Returns the labels defined in the connected mailbox."],
      alternativeOperationIds: [],
    },
    {
      id: "stripe.issue_refund",
      provider: "stripe",
      sideEffect: "write_create",
      resourceType: "payment",
      dataSensitivity: "confidential",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: true,
      argumentFields: [
        { key: "payment_id", type: "string", required: true, identifiesResource: true },
        { key: "amount_cents", type: "number", required: true, identifiesResource: false },
      ],
      preconditions: [
        "The payment must belong to the order or customer the task names.",
        "The amount must not exceed the payment's original amount.",
      ],
      effects: ["Refunds the named amount against the named payment; this is a real financial transaction."],
      alternativeOperationIds: [],
    },
    {
      id: "stripe.retrieve_payment",
      provider: "stripe",
      sideEffect: "read",
      resourceType: "payment",
      dataSensitivity: "confidential",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [{ key: "payment_id", type: "string", required: true, identifiesResource: true }],
      preconditions: [],
      effects: ["Returns one payment's amount, currency, customer, and status."],
      alternativeOperationIds: [],
    },
    {
      id: "stripe.retrieve_customer",
      provider: "stripe",
      sideEffect: "read",
      resourceType: "customer",
      dataSensitivity: "confidential",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [{ key: "customer_id", type: "string", required: true, identifiesResource: true }],
      preconditions: [],
      effects: ["Returns one customer's id, email, and name."],
      alternativeOperationIds: [],
    },
    {
      id: "stripe.list_charges",
      provider: "stripe",
      sideEffect: "read",
      resourceType: "customer",
      dataSensitivity: "confidential",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [{ key: "customer_id", type: "string", required: true, identifiesResource: true }],
      preconditions: [],
      effects: ["Returns the named customer's charges; never another customer's."],
      alternativeOperationIds: [],
    },
    {
      id: "slack.post_message",
      provider: "slack",
      sideEffect: "write_create",
      resourceType: "channel",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [
        { key: "channel", type: "string", required: true, identifiesResource: true },
        { key: "text", type: "string", required: true, identifiesResource: false },
      ],
      preconditions: ["The channel must be identifiable from the task's own intent or trusted inputs."],
      effects: ["Posts one message to the named channel in the connected workspace."],
      alternativeOperationIds: [],
    },
    {
      id: "slack.list_channels",
      provider: "slack",
      sideEffect: "read",
      resourceType: "workspace",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [],
      preconditions: [],
      effects: ["Returns the channels visible to the connected workspace's bot user."],
      alternativeOperationIds: [],
    },
  ],
  permissions: [
    {
      id: "github.issues_read",
      provider: "github",
      operations: ["github.get_issue"],
      classification: "read",
      riskCost: 1,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.issues_read_alt",
      provider: "github",
      operations: ["github.get_issue"],
      classification: "read",
      riskCost: 1,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.repository_read",
      provider: "github",
      operations: ["github.read_repository"],
      classification: "read",
      riskCost: 2,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.repo_read",
      provider: "github",
      operations: ["github.get_issue", "github.read_repository"],
      classification: "read",
      riskCost: 2,
      resourceBreadth: 2,
      allowsExternalCommunication: false,
    },
    {
      id: "github.pull_requests_read",
      provider: "github",
      operations: ["github.get_pull_request"],
      classification: "read",
      riskCost: 1,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.files_write",
      provider: "github",
      operations: ["github.put_file"],
      classification: "write",
      riskCost: 2,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.branches_write",
      provider: "github",
      operations: ["github.create_branch"],
      classification: "write",
      riskCost: 2,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.commits_write",
      provider: "github",
      operations: ["github.push_commit"],
      classification: "write",
      riskCost: 2,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.contents_write",
      provider: "github",
      operations: ["github.create_branch", "github.push_commit"],
      classification: "write",
      riskCost: 5,
      resourceBreadth: 3,
      allowsExternalCommunication: false,
    },
    {
      id: "github.branches_delete",
      provider: "github",
      operations: ["github.delete_branch"],
      classification: "write",
      riskCost: 6,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.pull_requests_write",
      provider: "github",
      operations: ["github.create_pull_request"],
      classification: "write",
      riskCost: 2,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "github.repo_admin",
      provider: "github",
      operations: [
        "github.get_issue",
        "github.read_repository",
        "github.create_branch",
        "github.push_commit",
        "github.create_pull_request",
        "github.get_repository_secrets",
      ],
      classification: "admin",
      riskCost: 8,
      resourceBreadth: 10,
      allowsExternalCommunication: false,
    },
    {
      id: "github.secrets_read",
      provider: "github",
      operations: ["github.get_repository_secrets"],
      classification: "read",
      riskCost: 9,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "gmail.send_email_scope",
      provider: "gmail",
      operations: ["gmail.send_email"],
      classification: "write",
      riskCost: 3,
      resourceBreadth: 1,
      allowsExternalCommunication: true,
    },
    {
      id: "gmail.read_scope",
      provider: "gmail",
      operations: ["gmail.list_messages", "gmail.get_message", "gmail.list_labels"],
      classification: "read",
      riskCost: 2,
      resourceBreadth: 3,
      allowsExternalCommunication: false,
    },
    {
      id: "stripe.refunds_write",
      provider: "stripe",
      operations: ["stripe.issue_refund"],
      classification: "write",
      riskCost: 4,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "stripe.payments_read",
      provider: "stripe",
      operations: ["stripe.retrieve_payment"],
      classification: "read",
      riskCost: 1,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "stripe.customers_read",
      provider: "stripe",
      operations: ["stripe.retrieve_customer", "stripe.list_charges"],
      classification: "read",
      riskCost: 2,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "slack.messages_write",
      provider: "slack",
      operations: ["slack.post_message"],
      classification: "write",
      riskCost: 2,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "slack.channels_read",
      provider: "slack",
      operations: ["slack.list_channels"],
      classification: "read",
      riskCost: 1,
      resourceBreadth: 2,
      allowsExternalCommunication: false,
    },
  ],
};
