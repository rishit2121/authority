# Invite-only developer pilot

Authority's console is invite-only. Anyone can read the marketing pages and docs, sign in, and
submit `/request-access`; only approved developers (and the owner) can onboard and use the console.

## Who manages it

The owner is `pilot_settings.owner_email` (seeded as `owner@example.invalid`). Owner checks
use the caller's **verified** email from `auth.users` (`email_confirmed_at` set), in the database,
on every page load, server action and RPC. A submitted email, URL parameter, JWT claim or user
metadata is never trusted. Everyone else gets a 404 at `/app/pilot`, and the `pilot_admin_*`
RPCs refuse them (`42501`). The pilot tables have RLS enabled and no grants to `anon` or
`authenticated`.

## The gate

`pilot_settings.gate_enabled` starts **off** so you can approve existing accounts first. While
it's off, behavior is unchanged. While it's on:

| Surface                                                               | Unapproved verified user                                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/app/**` pages, server actions, connector routes (`requireIdentity`) | Redirected to `/invite-only`                                                                                                                                                         |
| `/auth/callback` after email confirmation                             | Redirected to `/invite-only`                                                                                                                                                         |
| `/signup`                                                             | Same neutral "check your inbox" response, but no account is created. The response is identical to a real sign-up, so the form can't be used to check whether an address is approved. |
| `ensure_onboarded()` (database)                                       | Raises `42501`; no workspace is created, even for an auth user created by calling Supabase directly                                                                                  |
| Session APIs (`/api/validation/**`)                                   | `403 invite_only`                                                                                                                                                                    |
| Workspace switching                                                   | Refused                                                                                                                                                                              |

Approval is not authentication: Supabase still requires email confirmation. Approval also never
grants workspace data, which membership and RLS still decide. Your applications' external
customers are unaffected; backend and agent credentials never go through the pilot check.

## Approving people

1. Open `/app/pilot` (the **Pilot** item appears in the sidebar for the owner only).
2. **Accounts** tab: before turning the gate on, approve every existing account that should keep
   access. Nothing is approved automatically. The owner is always eligible.
3. A request's detail view has **Approve**, **Decline**, **Revoke** (approved → declined),
   **Mark pending** and private notes. **Add an approved email** whitelists someone you invited
   directly.
4. Tell the person yourself. Authority never emails applicants. They sign up at `/signup` with
   that exact address and confirm it.
5. Turn the gate on.

## What revoking does

- **Console:** blocked on their next request. Every protected request re-reads the user from the
  Auth server and re-checks approval, so they land on `/invite-only`. Their Supabase session is
  not deleted; it simply no longer opens anything.
- **Workspaces and data:** kept. Memberships aren't removed, so re-approving restores access.
- **Application credentials** (backend and agent keys) created in their workspace **keep
  working**. They belong to the workspace, not the person. To cut off API use, revoke them under
  Settings → Applications as a workspace admin, or delete the workspace.
- **Residual:** an existing member holding a still-valid Supabase access token (up to 1 hour) can
  read their own workspace rows directly through Supabase's REST API under RLS. Revocation doesn't
  change RLS.

## Request form

- Fields: name, email, optional company/project, "What are you building?", "How would you use
  Authority?", optional services. Validated in the server action and again in
  `gateway.submit_pilot_request`, which also enforces the length limits.
- **Dedup:** one row per trimmed, lowercased email. A repeat submission refreshes the answers and
  never touches status or notes. New and repeat submissions get the same confirmation.
- **Rate limit:** 5 per hour per hashed client IP, and 3 per hour per email. Raw IPs are never
  stored.
- The public can't list requests, look up a status or change one. There is no read path for anon.

## Owner notification email (optional)

When a **new** request is saved, Authority emails the owner the name, email, project, answers and
a link to `/app/pilot?id=…`, through Resend's HTTP API. It is sent only to `owner_email`, never to
an applicant, and never through any connected Gmail account.

- Applicant text is HTML-escaped, and the subject has newlines stripped.
- It runs after the row is committed. A failure or timeout (5 s) never blocks or loses the
  request.
- Repeat submissions don't re-notify. The request id is Resend's `Idempotency-Key`.
- The result is recorded on the request (`sent` / `failed` / `not_configured`, plus a short detail
  without secrets) and shown in the detail view.

Setup:

1. Create a Resend account, add and verify a sending domain (DNS records Resend shows: SPF/DKIM).
2. Create an API key with **Sending access** only.
3. On Render (Environment), set:
   - `RESEND_API_KEY=re_…`
   - `PILOT_NOTIFY_FROM=Authority <pilot@your-verified-domain>`
   - optionally `PILOT_IP_SALT=<random string>`
4. Redeploy. `AUTHORITY_PUBLIC_URL` (or Render's `RENDER_EXTERNAL_URL`) is used for the dashboard link.

Without these, requests are saved and show `not_configured`.
