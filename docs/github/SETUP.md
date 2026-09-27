# Setting up the GitHub App (live verification)

Everything is built and tested against a mock. To verify against real GitHub you must create the App and install it on
**one throwaway test repository**. Do not paste keys or secrets into chat: put them in the ignored file/env vars below.

## 1. Create the App (GitHub → Settings → Developer settings → GitHub Apps → New)

| Field                                                  | Value                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| GitHub App name                                        | e.g. `Authority (dev)` — the URL slug becomes `GITHUB_APP_SLUG`                                                    |
| Homepage URL                                           | your `AUTHORITY_PUBLIC_URL`                                                                                        |
| Callback URL                                           | `<AUTHORITY_PUBLIC_URL>/api/github/oauth/callback`                                                                 |
| Setup URL                                              | `<AUTHORITY_PUBLIC_URL>/api/github/setup`                                                                          |
| Redirect on update                                     | on (so adding/removing repos returns to Authority)                                                                 |
| Request user authorization (OAuth) during installation | **off** (Authority runs its own state-bound OAuth step)                                                            |
| Expire user authorization tokens                       | on                                                                                                                 |
| Webhook → Active                                       | on                                                                                                                 |
| Webhook URL                                            | `<AUTHORITY_PUBLIC_URL>/api/github/webhook`                                                                        |
| Webhook secret                                         | generate a long random string → `GITHUB_WEBHOOK_SECRET`                                                            |
| Repository permissions                                 | **Metadata: Read-only; Contents: Read and write; Issues: Read-only; Pull requests: Read and write** — nothing else |
| Account / organization permissions                     | none                                                                                                               |
| Subscribe to events                                    | none needed (`installation` and `installation_repositories` are delivered by default)                              |
| Where can it be installed                              | Only on this account                                                                                               |

(For local testing use a public tunnel URL as `AUTHORITY_PUBLIC_URL`, since GitHub must reach the webhook.)

After creating it: note the **App ID** and **Client ID**, generate a **client secret**, and generate a **private key** (.pem).

## 2. Install it

App page → Install App → your account → **Only select repositories** → choose the throwaway test repository only.

## 3. Deployment configuration (server-side only; never `NEXT_PUBLIC_`)

Store the private key at an ignored path, e.g. `./.secrets/github-app.pem` (`.secrets/` and `*.pem` are git-ignored), and
set these in `.env.local` (dev) or the deployment secret store:

```
GITHUB_EXECUTION_MODE=live
AUTHORITY_PUBLIC_URL=https://<your public origin>
GITHUB_APP_ID=<App ID>
GITHUB_APP_CLIENT_ID=<Client ID>
GITHUB_APP_CLIENT_SECRET=<client secret>
GITHUB_APP_SLUG=<app slug>
GITHUB_WEBHOOK_SECRET=<webhook secret>
GITHUB_APP_PRIVATE_KEY_FILE=./.secrets/github-app.pem     # or GITHUB_APP_PRIVATE_KEY / GITHUB_APP_PRIVATE_KEY_BASE64
GATEWAY_DATABASE_URL=...   GATEWAY_DATABASE_CA=...         # required in production (readiness fails without the CA)
```

Missing variables make `/api/v1/ready` report `github: misconfigured` (503) and the connector refuse to run; nothing
falls back to mock in production.

## 4. Verify

1. `/app/integrations/github` → **Connect GitHub** → complete install → status `active`, badge **LIVE GitHub**.
2. Allow the test repository, bind a task, run an agent workflow.
3. Optional automated check: [LIVE_SMOKE_TEST.md](LIVE_SMOKE_TEST.md).
