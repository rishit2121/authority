> **Status (Part 7 delivered):** items 1–12 and 16 are implemented — see [../github/CONNECTOR.md](../github/CONNECTOR.md). Item 13:
> production readiness now fails without `GATEWAY_DATABASE_CA` (the authorize/admin role split and signed evidence remain open). Items 14
> (token re-delivery) and 15 (real-provider calibration) remain open. The App key lives in the deployment secret boundary (env / ignored
> file) rather than Supabase Vault; nothing secret is stored in ordinary tables.

# Part 7 (first real GitHub connector): exact requirements

Part 6 delivers everything upstream of execution. Part 7 replaces the _simulated_ step of
`POST /api/v1/capabilities/consume` with a real GitHub call. It must not weaken anything below.

## Credentials

1. **GitHub App, not a PAT.** Per-tenant installation id stored in `integrations`; the App private key in Supabase Vault
   (or a KMS), read only by a dedicated server-side role/function — never in an ordinary table, env-file committed to
   git, log or response.
2. **Mint an installation token per execution**, restricted to the single repository and the minimal permission set the
   capability's tool implies (e.g. `issues: read`), short-lived (≤ 60 s), discarded after the call. Never persist or
   return it.
3. Move the semantic-provider key to the same Vault and add a write-only settings flow (Part 6 keeps it in the env).

## Execution path

4. Execute **only** from a validated consumption: reuse `gateway.consume_capability()`'s checks unchanged (token, agent,
   tenant, expiry, uses, contract/task/agent/issuing-key liveness, exact tool/operation/resource/argument hash,
   constraints). The agent supplies the arguments at consume time (Authority stores none), so the connector executes
   exactly the hashed call.
5. **Two-phase consumption**: `reserve` (atomic, as today) → execute → `confirm` or `fail`. Define what a failed or
   timed-out execution does to `uses` (release for a definitively-not-executed call; keep + flag when the outcome is
   unknown) and make `confirm/fail` idempotent under the same consumption key.
6. Relax `capability_consumptions.simulated = true` only for rows written by the connector, behind a connector
   attestation (a distinct gateway function/role), and keep simulated and real rows distinguishable in every view.
7. Egress controls: fixed `api.github.com` host, TLS verified, request timeout, bounded response size, no redirects to
   other hosts, retry only idempotent reads, respect primary and secondary rate limits.

## Data

8. Map the registry's GitHub operations (`github.get_issue`, `list_*`, `create_branch`, `delete_branch`, …) to concrete
   API calls with a per-operation argument schema and a **resource identifier** (`owner/repo[#n]`); intersect the App
   installation's repository access with the contract's constraints and refuse anything outside either.
9. Record a receipt, not the response: status, GitHub request id, content hash of the response, size. Real
   `tool_invoked` events replace the "SIMULATED" ones. Never store issue bodies, tokens or file contents.
10. Keep argument privacy: the connector receives raw arguments in memory only.

## Gaps Part 6 leaves that Part 7 should close or consciously accept

11. **Approvals → capabilities.** A `require_approval` final (from semantic narrowing) is recorded but nothing resolves
    it into a capability. Decide the flow (approver identity, TTL, re-evaluation on approval).
12. **Budget on expiry.** Unused capabilities keep their budget reserved; decide on release.
13. **Verify the gateway DB TLS chain** (`GATEWAY_DATABASE_CA`) and split the gateway role by function
    (authorize vs admin); consider signed semantic-evidence attestations.
14. **Token re-delivery** on a lost response (currently: revoke and retry).
15. Real-provider calibration: run the `openai_compatible` adapter (never exercised live in Part 5/6) through the
    evaluation corpus and real labeled traffic before enabling it as an enforcement-grade provider.
16. Remove the legacy `public.authorize_tool_call` family once suites 17/18 are ported to the gateway functions.
