# Custom API: supported operation schema

A Custom API operation declares one HTTP request shape — method, path
template, and a fixed set of typed input fields — that an authorized agent
may invoke by name. This document is the explicit, versioned subset of
"what a definition may say," referenced by:

- `gateway.validate_custom_operation` (`supabase/migrations/20261001000005_custom_operations.sql`)
- `src/lib/connectors/custom-api/validate.ts` (the stricter, field-aware authoring-time check)
- `src/lib/connectors/custom-api/request-builder.ts` (the runtime request builder, which enforces the same rules independently)

If a rule isn't written here, it isn't supported — there is no implicit
escape hatch. Extending this schema is a deliberate, reviewed change to all
three places above, plus their tests.

## Definition shape

```jsonc
// input_schema (schemaVersion 1)
{
  "schemaVersion": 1,
  "fields": [
    { "key": "orderId", "type": "string", "required": true, "identifiesResource": true, "in": "path" },
    { "key": "status",  "type": "string", "required": false, "identifiesResource": false, "in": "query" },
    { "key": "reason",  "type": "string", "required": false, "identifiesResource": false, "in": "body" }
  ]
}

// request_mapping (schemaVersion 1) — static, non-secret, admin-authored only
{
  "schemaVersion": 1,
  "staticHeaders": [{ "name": "x-api-version", "value": "2024-01-01" }],
  "staticQuery": [{ "name": "source", "value": "authority" }]
}
```

## Rules

**Path template**

- Must start with `/`.
- Must not contain `..` or `//`.
- Every `{name}` placeholder must have exactly one declared field with
  `"in": "path"` and that exact key; every `"in": "path"` field must appear
  as a placeholder. (Symmetric — no orphaned placeholders, no unused path
  fields.)
- A path field is always `"required": true` — an optional path segment
  isn't a thing this schema can express.
- A path *value* may never itself contain `/`, `\`, `..`, or their
  percent-encoded forms (`%2f`, `%5c`, `%2e%2e`) — enforced at request-build
  time (`assertSafePathSegment`), not authoring time, since it depends on
  the agent's actual argument value, not the definition.

**Fields**

- 1 to 20 fields per operation.
- `key`: starts with a letter or underscore, then letters/digits/underscores,
  up to 100 characters. Unique within the operation.
- `type`: exactly one of `string`, `number`, `boolean`. No arrays, no
  objects, no nested structures.
- `in`: exactly one of `path`, `query`, `body`. Never `header` — an agent's
  own arguments can never become a header; only `request_mapping`'s static,
  admin-authored headers can, and even those are checked against
  `FORBIDDEN_HEADER_NAMES`.
- Exactly one field across the whole operation must have
  `"identifiesResource": true` — this is the value a capability's resource
  binding is checked against, so there must be exactly one unambiguous
  answer to "what resource does this call touch."

**Request mapping**

- `staticHeaders` / `staticQuery`: fixed name/value pairs set by the admin
  who authored the operation, applied to every call. Never derived from an
  agent's arguments, never a template, never code.
- A static header name may not be `host`, `content-length`,
  `transfer-encoding`, `connection`, `proxy-authorization`, or
  `authorization` — the first five are transport-layer concerns a connector
  must control itself; the last is set exclusively by this connector's own
  credential resolution (see Authentication below), never by static config
  and never by an agent.

**Authentication**

- `auth_type`: `none`, `bearer`, `api_key_header`, or `basic`.
- The credential itself (bearer token, API key, or basic username/password)
  is never part of the operation definition. It is stored once per
  *connection* (not per operation) in `connector_connection_secrets`,
  referencing a Supabase Vault secret by UUID, and resolved only inside the
  connector's own `execute()` at dispatch time. An operation's `auth_config`
  may only carry non-secret configuration (currently: the header name for
  `api_key_header`).
- An agent's own declared fields can never populate the `Authorization`
  header or any credential — there is no field `in` value that reaches a
  header at all.

## What happens to a request an agent sends

1. Arguments are validated against `fields` exactly (`validateArguments`):
   every required field present and correctly typed, no undeclared keys.
2. Each field's value is placed into the path, query string, or JSON body
   per its own `in`, in the order fields are declared, with path values
   additionally checked for traversal.
3. Static `request_mapping` entries are added.
4. The connector resolves the connection's stored credential (if any) and
   sets the one authentication header this operation declares — never a
   header the agent or a static mapping entry supplied.
5. The request is sent through `safeFetch` (SSRF/DNS-rebinding guard,
   HTTPS-only, no redirects followed, response size and time bounded).

## What this subset deliberately does not support (yet)

- Array or object-typed fields.
- Conditional/optional path segments.
- Per-call dynamic headers (only the fixed, admin-authored static set).
- More than one resource-identifying field per operation (an operation that
  needs to identify a resource by a composite key should express it as a
  single field — e.g. a combined path segment — rather than two
  `identifiesResource` fields, since a capability's resource binding is a
  single string).

Each of these would need an explicit schema version bump plus changes to
all three enforcement points listed at the top of this document, not a
silent extension of `schemaVersion: 1`.
