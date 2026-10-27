# Authority v0.2.0: first public release (experimental)

Authority is a task-scoped authorization gateway for AI agents. Your trusted backend describes what a task may do.
Authority compiles that into a contract: which tools, which exact recipients and resources, and how many times. It
binds a short-lived session to the task and decides every agent call against the contract in PostgreSQL before
anything runs. For connector tools, it performs the call itself, so the agent never holds the provider credential.

**This is an experimental release.** It is not production-proven and has had no third-party audit. Read
[LIMITATIONS.md](LIMITATIONS.md) before relying on it.

## What it enforces

- Exact pinned values: recipient, channel, id, path, branch or amount. A different value is refused.
- Closed-world arguments: a key the plan neither pinned nor left open as free text is refused.
- Per-step invocation budgets.
- Task and customer binding. A task session works only for its own task.
- Atomic decisions with idempotent replay and single-use, short-lived capabilities.
- Credential-holding execution for GitHub, Gmail, Slack, Stripe, Linear, Notion, PostgreSQL and custom HTTPS APIs.
  Every outcome gets a receipt, and an uncertain write is never retried.

## Changes since v0.1.0 (selected)

- **Closed-world arguments.** Extra argument keys are refused (`CONSTRAINT_VIOLATION`).
- **Data flow.** Only free-text fields may take a value from an earlier step. Prepare reports `excludedSteps`.
  QUICKSTART §3 shows how an agent writes a message after reading data.
- **Budget fixes:**
  - A capability revoked while its write was in flight no longer refunds the use. Before, an agent could revoke its
    own capability mid-write and exceed `maxInvocations`.
  - GitHub executions that never reached GitHub return their budget, as other connectors already did.
- **MCP.** Tool discovery requires a valid credential for the task.
- **`/capabilities/consume`.** It refuses connector tools; use `/execute` for those.
- **Verifier and connectors:**
  - The verifier checks a contract's hash against its content and fails closed on list arguments.
  - Jev's narrowing works in enforce mode.
  - Network guards classify addresses by binary value.
  - PostgreSQL published reads run in a read-only transaction.
- **Builds** use vendored fonts and fetch nothing at build time.
- **Tests added:** pgTAP security suites in CI on a throwaway Supabase; a cross-entrypoint (REST and MCP) regression
  suite; execution and disconnect races against a mock provider; a real-API evaluation.

## Upgrading an existing deployment

- **Apply migrations `20261023000001`, `…0002` and `…0003`, then deploy.** `/ready` reports `mismatch` until both are
  done. `supabase/rollback/20261023_rollback_to_20261022000002.sql` reverses the three migrations.
- **Re-prepare active tasks.** Contracts compiled by earlier versions return `UNSUPPORTED_CONTRACT_VERSION`.
- **Remove unexpected argument keys from agent calls.** They are now refused. MCP drops keys a tool does not declare.
- **Pin required free-text fields, or bind them with `dataFlowRefs`.** This applies to Slack `text`, email `subject`
  and issue `title`.
- **Authorize again rather than reusing a retired capability.** A single-use capability released before dispatch is
  retired.

## Known limitations

- **Open free text can say anything.** Authority pins targets and values, not content.
- **Budgets reset with each contract version.** There is no task-wide ceiling.
- **Model review is optional and probabilistic.** Task alignment, content screening and risk review can only narrow
  a decision. Backend prepare skips Jev checks but can run task-alignment review. With `generate: true`, a model
  drafts the plan that becomes the contract.
- **Security-relevant values taken from earlier steps are unsupported.**
- **Simulated execution (`/capabilities/consume`) is not provider execution.**
- **Browser agents are not covered.** A separate experiment confined navigation URLs only: 4 of 4 injected
  navigations were denied in a small run. Form submissions and scripts on a permitted page were not governed.
- **Evidence limits.** Race and disconnect behaviour is tested against a mock provider only. Nothing in this release
  verifies real-provider behaviour, model accuracy or behaviour under load.

## License

MIT, `Copyright (c) 2026 Rishit Agrawal`. Fonts, provider logos and some dependencies keep their own terms; see
`THIRD_PARTY_NOTICES.md`.

## Reporting vulnerabilities

Report privately through GitHub (**Security → Report a vulnerability**). See `SECURITY.md`.
