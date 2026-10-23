# Architecture and trust boundaries

## Parties and credentials

| Party                              | Trusted for                                  | Credential                                                                     | Can do                                                                                        |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Trusted application (your backend) | stating the user's request and the task plan | backend key `authority_dk_…` (per application)                                 | create customers and tasks, prepare (compile) contracts, revise objectives                    |
| Agent                              | nothing; it may be confused or adversarial   | runtime key `authority_rk_…` (per agent), exchanged for a task session         | open a session for one task, list its tools, request authorization, execute with a capability |
| Administrator                      | tenant configuration                         | dashboard sign-in, role-checked in the database                                | connections, approval rules, alignment and session settings, approvals                        |
| Authority server                   | running the pipeline faithfully              | `GATEWAY_DATABASE_URL` (the `authority_gateway` role) and provider credentials | call `gateway.*` functions; hold provider tokens                                              |
| Database                           | the final decision                           | —                                                                              | decides and commits; enforces row level security, immutability and tenant isolation           |

The agent never receives the backend key, a provider credential, a URL or an HTTP method. A task session token is
valid for one task only. If an application requires sessions, a raw runtime key cannot act on any task.

## Layers

| Layer                            | Role                                                                                                                                         | Boundary                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Task and customer                | the backend creates a customer-scoped task with its connection bindings                                                                      | the agent does not choose the customer or task                                            |
| Plan                             | the backend submits a structured plan (or asks a model to draft one)                                                                         | a plausible plan can still be wrong; optional alignment review gives model-based evidence |
| Validator and solver             | registry, argument types, dependencies, policies; minimum catalog permissions                                                                | covering a plan minimally does not prove it is the right task                             |
| Compiler                         | one action per (tool, pinned values), budgets, open free-text arguments, expiry, hashes                                                      | concrete values are pinned exactly; derived values only for free text                     |
| Verifier                         | re-derives and compares                                                                                                                      | a consistency check sharing the compiler's code, not an independent proof                 |
| Runtime authorization (SQL)      | authenticate, check task, contract, versions, pinned values, closed-world arguments, budgets; commit a decision and a short-lived capability | a model cannot grant a call that fails here                                               |
| Connector execution              | reserve, dispatch with Authority-held credentials, settle a receipt; uncertain outcomes are never retried                                    | stronger than authorizing a call and letting an unmediated client act                     |
| Optional alignment and screening | compare plans and calls with the request; inspect outside content                                                                            | probabilistic; narrow-only                                                                |

## Where decisions are made

`/api/v1/authorize` resolves the credential, applies the session policy, optionally runs model checks, then calls
`gateway.commit_authorization` (or `commit_authorization_aligned` when an alignment review cleared the call). That
function re-evaluates the request under the task lock with `gateway.evaluate_deterministic`, reserves budget, and
issues a capability whose hash is stored. Execution routes re-validate the capability and re-check the contract,
task, agent and connection at dispatch. The database functions are `SECURITY DEFINER`, executable only by the
`authority_gateway` role, and not exposed through PostgREST; see [gateway/TRUST_MODEL.md](gateway/TRUST_MODEL.md).

## Evidence

Every decision (deterministic, semantic, final), capability event, approval and execution receipt is stored
append-only. A task's history shows what was requested, what was decided and why (reason codes), and what ran.
Simulated consumption is labelled as simulated.

## Related

[ENFORCEMENT_PROFILE.md](ENFORCEMENT_PROFILE.md) — which checks run on each entrypoint ·
[SECURITY.md](SECURITY.md) — threat model and guarantees · [LIMITATIONS.md](LIMITATIONS.md) ·
[api/RUNTIME_API.md](api/RUNTIME_API.md)
