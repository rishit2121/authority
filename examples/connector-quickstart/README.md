# Connector quickstart

One runner, one shared `@authority/sdk` flow, for all six connectors: select a connector, reuse an existing connection or GitHub delegation, prepare a bounded task, handle automatic activation or a pending approval, execute one safe operation, demonstrate an out-of-scope denial, and print sanitized status and receipt IDs. No manual capability copying, no raw SQL.

Whether a given run is **live** (a real provider account) or **fixture** (this repo's own in-memory test server) is entirely a property of how the underlying connection was configured on the dashboard -- this script cannot see or control that, and never claims one when it's the other.

## Setup

```
cp .env.example .env.local   # fill in the Authority section
npm install                  # from repo root: npm run sdk:build, once
```

Each connector needs its own connection (or, for GitHub, a delegated repository) already set up and delegated to `CUSTOMER_ID` -- via the dashboard or the developer API. This script never creates one.

## Run

```
npm run gmail
npm run github
npm run stripe
npm run slack
npm run postgres     # needs POSTGRES_TOOL/OPERATION/RESOURCE/ARGS_JSON -- see .env.example
npm run custom-api    # needs CUSTOM_API_TOOL/OPERATION/RESOURCE/ARGS_JSON -- see .env.example
```

Postgres and Custom API have no fixed demo operation across tenants (they're tenant-published, not static registry entries) -- point `*_TOOL`/`*_OPERATION`/`*_RESOURCE`/`*_ARGS_JSON` at a query/operation you've already published for that connection.

A task's contract has a default 1-hour authority window; re-running with the same `RUN_ID` resumes a specific prior run, and a fresh `RUN_ID` (the default) always starts a new one, so an expired contract never permanently blocks a customer.
