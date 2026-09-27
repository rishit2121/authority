# CLI and CI

## CLI

```bash
npm run -s validate -- --pack starter                       # human-readable, exit code 0/1
npm run -s validate -- --pack starter --format json --out validation-report.json
npm run -s validate -- --scenarios recipient-substitution --variants baseline,unpinned-recipient
npm run -s validate -- --pack starter --baseline validation/baseline.starter.json
npm run -s validate -- --list
```

`-s` keeps npm's own banner out of `--format json` output. Options: `--pack`, `--scenarios`, `--variants`, `--repetitions 1-5`,
`--seed`, `--format json|text`, `--out`, `--baseline`, `--write-baseline`, `--strict`, `--concurrency 1-4`, `--list`.

| Exit | Meaning                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0    | pass                                                                                                                             |
| 1    | a run failed (packs marked `all_pass`, or with `--strict`) or a **regression**: a run that passed in `--baseline` no longer does |
| 2    | usage error (unknown pack/scenario, bad option)                                                                                  |
| 3    | infrastructure error (database unreachable, engine failure)                                                                      |

The CLI is **ephemeral**: it persists nothing to any tenant, creates sandbox tenants with no owner, and destroys them. It needs
only `GATEWAY_DATABASE_URL` (the restricted `authority_gateway` login) on a database with this repo's migrations. No production
credential is involved. The `hardening-gaps` pack is informational (failures are expected); it exits 0 unless `--strict`.

`validation/baseline.starter.json` records the verdict of each starter scenario. Refresh it deliberately with
`--write-baseline` when you add scenarios; never to make a failing PR pass.

## GitHub Actions

| Workflow                    | Trigger                   | Needs secrets                              | Required |
| --------------------------- | ------------------------- | ------------------------------------------ | -------- |
| `ci.yml` / `quality`        | every PR and push to main | none (placeholder public values)           | yes      |
| `ci.yml` / `scenario-packs` | every PR and push to main | none (throwaway local Supabase via Docker) | yes      |
| `integration.yml`           | manual only               | a **development** Supabase project         | no       |
| `maintenance.yml`           | schedule / manual         | your deployment URL + `MAINTENANCE_TOKEN`  | no       |

`scenario-packs` runs `supabase start`, provisions the `authority_gateway` login with a throwaway password, runs the starter
pack with `--baseline`, uploads the JSON report as an artifact, and writes the summary to the job page. **A pull request that
lets a previously contained attack through fails this check.** Note: this job could not be exercised locally in the
environment this was built in (no Docker); the CLI and the exact commands were verified against the hosted development
database, and the workflow follows the documented Supabase CLI pattern. Watch its first run.

## Using the engine from your own code

```ts
import { runCampaign } from "@/lib/validation/engine/campaign";
const report = await runCampaign({
  config: { scenarioKeys: ["capability-replay"], variants: ["baseline"], repetitions: 1 },
  spec,
  seed: 1,
  persist: null,
  ownerTenantId: null,
  actorUserId: null,
});
```

For your own agent, put it behind Authority (`examples/agent`) and run the same attack patterns against your real
task contracts in a non-production tenant.
