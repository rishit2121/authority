# JSONB schema versioning

Every flexible JSON document column in the Part 2B product schema carries an
explicit `schemaVersion` integer key. This is the mechanism, applied
identically everywhere it's used:

## Shape

```json
{ "schemaVersion": 1, ...rest of the fields... }
```

## Enforcement

Every such column has a `CHECK` constraint calling a single reusable
predicate:

```sql
check (authz.has_allowed_schema_version(column_name, array[1]))
```

`authz.has_allowed_schema_version(payload, allowed)` is `IMMUTABLE`, reads
only `payload->>'schemaVersion'`, and is defined once in
`20260923000001_product_enums.sql`. A row cannot be inserted or updated with
an unversioned or unrecognized-version payload — the database rejects it
before a mapper ever sees it.

## Where it's used

- `task_authority_contracts.ephemeral_limits`, `.source_evidence_metadata`
- `plans.model_metadata`
- `plan_nodes.normalized_arguments`
- `tool_requests.normalized_arguments`, `.destination_metadata`
- `semantic_decisions.probabilities`
- `authorization_decisions.reason_codes`, `.applied_constraints`,
  `.evidence_references`
- `capabilities.resource_constraints`, `.argument_constraints`
- `approvals.requested_authority_delta`
- `execution_events.normalized_effect_metadata`, `.receipt_metadata`
- `policies.conditions`
- `integrations.configured_scopes_metadata`, `.health_metadata`
- `tasks.trusted_context_provenance`

`task_authority_contracts.allowed_actions` is the one exception worth naming:
it's an array of objects (one per allowed action), so its version tag sits at
the array's wrapper level: `{"schemaVersion": 1, "items": [...]}`, checked the
same way.

`task_authority_contracts.forbidden_resources` is a flat `text[]` of glob
patterns, not JSONB — a bare array of strings has no shape to version.

## Migrating to a new version

When a column's shape needs to change:

1. Add the new version number to that column's `CHECK` (e.g.
   `array[1, 2]`), so both old and new rows validate.
2. Ship the mapper's `v1` branch unchanged; add a `v2` branch. Mappers reject
   any version not in their own known set — an unrecognized version raises
   rather than being guessed at.
3. Backfill existing `v1` rows to `v2` in a follow-up migration if the
   application no longer needs to read `v1` (optional — the mapper's dual
   branch can carry both indefinitely if backfilling isn't warranted).
4. Only once no `v1` rows remain (if you chose to backfill) does a later
   migration tighten the `CHECK` back down to `array[2]` and the mapper drops
   its `v1` branch.

Nothing here requires an app-wide flag day: old and new rows coexist under
the same column for as long as the mapper's version branches do.
