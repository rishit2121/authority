# Pilot checklist (v0.1)

For the person standing up Authority for a first real pilot user (yourself or a design partner).

## Before inviting anyone

- [ ] `npm run check:production -- --url https://<your-url>` reports zero blocking problems.
- [ ] `https://<your-url>/api/v1/ready` returns `{"status":"ready", "schema":"current", ...}`.
- [ ] Supabase → Authentication → URL Configuration has your real URL as Site URL and in Redirect URLs (otherwise
      email links point at localhost).
- [ ] `GATEWAY_DATABASE_URL` is the dedicated `authority_gateway` login (not `postgres`/service-role), and
      `GATEWAY_DATABASE_CA_FILE` (or `_CA`) is set so `tls: "verified"`.
- [ ] If you plan to use real GitHub: `GITHUB_EXECUTION_MODE=live` and every `GITHUB_APP_*`/`GITHUB_WEBHOOK_SECRET`
      variable is set (docs/github/SETUP.md); `GITHUB_EXECUTION_MODE=mock` and `AUTHORITY_ALLOW_MOCK_GITHUB` are **not**
      set in production.
- [ ] `MAINTENANCE_TOKEN` is set (24+ random characters), and either the in-process scheduler is enabled or the
      `maintenance.yml` GitHub Action has `AUTHORITY_URL`/`MAINTENANCE_TOKEN` repository secrets (docs/ops/OPERATIONS.md).
- [ ] Retention (Settings → Retention) is set to a period you're comfortable with (default 30 days for Validation Lab
      data; audit records are never purged).
- [ ] `npm run -s validate -- --pack starter` passes against the target database.

## First-run walkthrough (do this yourself before inviting a pilot user)

- [ ] Sign up through the real form; confirm the confirmation/reset email path works if email is configured.
- [ ] The Overview onboarding checklist reflects real state (no step is falsely marked done or falsely incomplete).
- [ ] Install the demo workspace OR create a real agent/task; confirm the empty-state copy matches what actually happens.
- [ ] Issue a runtime credential; confirm the secret is shown exactly once and never appears again anywhere in the UI.
- [ ] Create a task, review the compiled contract, activate it.
- [ ] Send one `/api/v1/authorize` call (curl or `examples/agent/sample-agent.mjs`) and see it appear on Runtime.
- [ ] If using GitHub: connect the App, allow one repository, bind a task, run one authorize → execute → receipt cycle.
- [ ] Validation Lab: create an environment, run the starter pack, open a run and see the attack tree, run the
      hardening-gaps pack, accept one remediation, confirm the regression appears and passes.
- [ ] Download a validation report (JSON, Markdown and HTML) and confirm it contains no raw argument values or tokens.
- [ ] Load every `/app/*` page at desktop, tablet and mobile widths; no horizontal scroll, no console errors
      (`npm run test:e2e -- accessibility-layout` automates this).

## Give the pilot user

- `docs/QUICKSTART.md` (ten minutes, start to finish)
- Their own login (or have them sign up) — do not share a runtime key or the gateway credential with them
- `examples/agent/` if they're integrating their own agent
- `docs/validation/OVERVIEW.md` so they understand what "synthetic" means before they see a scenario fail on purpose

## What to tell them explicitly

- What's real (their own tenant, real database enforcement, real capability lifecycle) versus what's simulated
  (Validation Lab campaigns, the mock semantic provider unless they configure a real one, mock GitHub unless connected
  live). See `docs/RELEASE_NOTES_v0.1.md`.
- Data retention: Validation Lab data ages out; audit/decision records do not.
- This is a pilot: expect rough edges, and file issues rather than routing around a refusal.
