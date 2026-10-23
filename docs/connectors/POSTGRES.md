# PostgreSQL connector: security boundary

An administrator publishes named, parameterized queries against their own database. An agent can run only a
published query, through a contract that pins its arguments. The connector holds the database credentials; the
agent never sees them.

## Network destination

- Private ranges are allowed, because the database is usually on a private network. Loopback, "this network",
  and link-local (including the `169.254.169.254` metadata endpoint) are refused in every IPv4 and IPv6 form
  (expanded, zero-padded, IPv4-mapped, IPv4-compatible, NAT64, 6to4). Addresses are compared as numbers, not text.
- A hostname is resolved once per call, every answer is checked, and the client connects to the checked address.
  With `sslmode=require`, the certificate is verified against the configured hostname.
- Keep network egress controls at the deployment as a second boundary.

## Reads

A query published as a read must start with `SELECT` or `WITH` and contain none of a list of data-modifying or
schema-changing keywords, including inside a CTE. That check reads text; it is not a SQL parser and cannot see
what a function called by the query does. So each read also runs inside `BEGIN READ ONLY ... COMMIT`, and
PostgreSQL refuses writes made in that transaction, including from inside a function.

What a read-only transaction does not cover: extensions that open their own connections or have external side
effects (for example `dblink` or a foreign data wrapper writing elsewhere), resource use, and reading anything the
connection's role is allowed to read. **Connect read-only queries with a database role that has only the `SELECT`
grants they need.** The transaction is defense in depth; the role is the main control. Neither proves that an
arbitrary query is harmless.

## Writes

A published write runs as a single parameterized statement with a timeout. There is no general way to ask a
database whether an interrupted write took effect, so a write whose outcome is unknown is reported as
indeterminate and is never retried automatically.
