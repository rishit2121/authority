# Live verification result (Part 7)

Run: `node scripts/live-verify.mjs` against the deployed app (Render) and the single authorized repository
`rishit2121/authority-github-test`. **35/35 checks passed.** The draft test PR is intentionally left open and unmerged:
https://github.com/rishit2121/authority-github-test/pull/1

- Deployment ready, verified DB certificate, connector mode `live`; installation active; granted permissions exactly
  `contents:write, issues:read, metadata:read, pull_requests:write`; the installation exposes no other repository.
- Real operations: read repository metadata; create one task branch (`authority/<task8>/…`); put one file under
  `docs/authority-live-test/`; open one **draft** PR; read it back. Each repeat was an idempotent `succeeded_noop`
  (one PR exists for the head branch).
- Guardrails refused before any GitHub call (reservation released, use refunded): default-branch write, `../` traversal,
  `.github/workflows`, smuggled URL argument, and a repository the task is not bound to.
- Replay of an idempotency key returned the recorded outcome; a spent capability was refused.
- Independent read-only confirmation via `gh api` on that repository only: `main` unchanged (`23fd344`), the branch and the
  file content are exactly as requested, the PR is an open draft and **not merged**.
- Persisted trace for the task (queried from the database): task → active contract v1 → 13 authorizations (all
  deterministic `allow`) → 13 capabilities → 13 reservations → 9 dispatched to GitHub (6 `succeeded`, 3 `succeeded_noop`,
  all with a GitHub request id, all labelled `live`) and 4 released before dispatch (the refused guardrail probes) → 13
  immutable receipts → the PR URL recorded in the receipts' resource ids.
- No GitHub token, key or runtime secret was found in receipts, events, reservations or tool requests.

Not exercised live (mock-verified only): webhook-driven state changes and permission drift (a webhook delivery did arrive
and verified), merging (forbidden), and branch deletion (unsupported by design).
