# Deploying Authority to Render (public URL)

`render.yaml` at the repo root is a Blueprint. It runs the same production build the e2e suite uses (`next build` / `next start`).
Verified locally: a production start with `GATEWAY_DATABASE_CA_FILE=./deploy/supabase-ca.crt` reports
`{"status":"ready","tls":"verified"}` from `/api/v1/ready`, and 503 `tls_unverified` without it.

## Steps

1. **Push the branch** (Render deploys from GitHub) and in Render: **New → Blueprint** → pick this repo/branch. Render reads `render.yaml`.
2. **Fill the three prompted secrets** (from `.env.local` — copy them in the dashboard, not into chat):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public; needed at build time).
   - `GATEWAY_DATABASE_URL` — the `authority_gateway` pooler URL (port 6543). If you have lost the password: `npm run gateway:provision` rotates it.
3. **Deploy.** Your URL is `https://authority-<suffix>.onrender.com`. `AUTHORITY_PUBLIC_URL` defaults to Render's `RENDER_EXTERNAL_URL`.
4. **Supabase → Authentication → URL Configuration**: set Site URL to that URL and add `https://<your-url>/**` to Redirect URLs, otherwise sign-in and email links point at localhost.
5. **Check**: `https://<your-url>/api/v1/ready` → `{"status":"ready",…,"tls":"verified"}`; sign in with a seeded or real account.

## Before you send traffic: readiness and maintenance

- `npm run check:production -- --url https://<your-url>` checks the deployment's configuration (database TLS verified, `https` public
  URL, no service-role key, mock GitHub off, complete live GitHub settings) and probes `/api/v1/health` and `/api/v1/ready`.
  `/api/v1/ready` also reports `schema: current`; a `schema: mismatch` (503) means migrations have not been applied.
- Reconciliation (expired leases, sandboxes, webhook retries, GitHub re-verification, retention) runs in-process every 5 minutes while the
  service is awake. On the free plan it sleeps, so also set `MAINTENANCE_TOKEN` (24+ random characters) in Render and add the repository
  secrets `AUTHORITY_URL` and `MAINTENANCE_TOKEN` so `.github/workflows/maintenance.yml` calls the endpoint every 15 minutes.
  Details: `docs/ops/OPERATIONS.md`.
- Validation Lab campaigns run inside the web process. On `starter` or above that is fine; on the free plan a campaign is lost if the
  service sleeps mid-run (the sweep marks it failed).

## Then, to enable real GitHub

Follow `docs/github/SETUP.md` using your Render URL for the callback/setup/webhook URLs, then in Render → Environment set
`GITHUB_EXECUTION_MODE=live`, `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`,
`GITHUB_WEBHOOK_SECRET` and `GITHUB_APP_PRIVATE_KEY_BASE64` (`base64 -i github-app.pem | tr -d '\n'`). Redeploy.

## Notes and trade-offs

- **Free plan sleeps** after ~15 min idle; the first request (and any GitHub webhook) may wait ~30–60 s. Use `plan: starter` for always-on.
- This points at the **current Supabase dev project** (the one with seeded `*.test` users). For anything real, create a separate Supabase
  project, apply `supabase/migrations`, run `npm run gateway:provision` against it, and use its keys.
- The Supabase root CA in `deploy/supabase-ca.crt` is public. If Supabase rotates it, replace the file (or set `GATEWAY_DATABASE_CA`).
- `GITHUB_EXECUTION_MODE=mock` is refused in production unless `AUTHORITY_ALLOW_MOCK_GITHUB=1` — a public mock demo is possible but opt-in.
- Quick alternative for a temporary URL without deploying: run `npm run build && npm start` and expose it with a tunnel
  (`cloudflared tunnel --url http://localhost:3000`), then use that origin as `AUTHORITY_PUBLIC_URL`.
