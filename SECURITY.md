# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** through GitHub's private vulnerability reporting: on this
repository, open **Security → Report a vulnerability**. Do not open a public issue, pull request or discussion for a
suspected vulnerability.

Include what you found, how to reproduce it (a local setup per [docs/QUICKSTART.md](docs/QUICKSTART.md) is ideal),
the affected commit or version, and the impact you expect. Never test against a deployment or data you do not own.

What to expect:

- an acknowledgement within 5 business days;
- an assessment, and a fix or mitigation plan, coordinated with you before anything is disclosed;
- credit in the advisory if you want it.

This is a small, early-stage project without a bug bounty.

## Supported versions

Authority is pre-1.0. Only the latest commit on `main` receives security fixes. There are no long-term-support
branches.

## Scope

In scope: the authorization boundary — contract compilation, sessions, runtime authorization, capability handling,
connector execution, tenant isolation, and the database functions behind them. The threat model, the guarantees
Authority makes and the ones it does not make are in [docs/SECURITY.md](docs/SECURITY.md) and
[docs/LIMITATIONS.md](docs/LIMITATIONS.md). A report showing that a documented limitation exists is welcome but is
not a vulnerability; a report showing that a documented guarantee does not hold is.
