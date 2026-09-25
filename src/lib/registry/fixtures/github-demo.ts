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
 */
export const githubDemoRegistry: RegistryData = {
  schemaVersion: 1,
  registryVersion: "github-demo-2026-09-23",
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
      ],
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
        { key: "to", type: "string", required: true, identifiesResource: false },
        { key: "subject", type: "string", required: true, identifiesResource: false },
      ],
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
      id: "stripe.refunds_write",
      provider: "stripe",
      operations: ["stripe.issue_refund"],
      classification: "write",
      riskCost: 4,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
  ],
};
