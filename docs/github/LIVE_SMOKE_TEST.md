# Live smoke test (opt-in, never CI)

`npm run test:github-live` exercises the connector's real operations against real `api.github.com` on ONE repository
you name. It is excluded from `npm test`, `npm run test:integration` and CI; with no variables set every test is
**skipped**. It never uses the database and never touches the default branch: it creates one branch under
`authority/<task>/`, one file, one **draft** pull request, reads them back, checks the guardrails, then closes the PR and
deletes its own branch.

Required environment (all of it; see [SETUP.md](SETUP.md) for the App variables):

```
GITHUB_EXECUTION_MODE=live  GITHUB_LIVE_SMOKE=1
GITHUB_SMOKE_INSTALLATION_ID=<installation id>
GITHUB_SMOKE_REPO=<owner/name of a THROWAWAY repository>
GITHUB_SMOKE_CONFIRM=I-UNDERSTAND-THIS-WRITES-TO-<owner/name>
```
