---
id: LAI-206
title: Expose migration and SMTP state so the first-boot status panel can exist
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-106
status: backlog
---

## Goal

`SystemStatus` (LAI-021) renders the first-boot panel the design specifies:
database engine, migration state, SMTP state. LAI-021's own criteria required
that it show **SQLite, never Postgres** — the prototype's `postgres 16 ·
connected` is an artifact (D-001, `docs/design/README.md`).

It is not rendered, because there is nothing real to feed it.
`GET /api/v1/setup/status` returns only `{ setup_required }`, and LAI-106 AC5 is
explicit that hardcoded numbers on a status panel are worse than no panel — a
panel confidently reporting `41/41 applied` while the truth is anything else is
worse than an absent one, because it is believed.

The component exists, is styled, and is covered by tests. It needs data.

## Acceptance criteria

- [ ] `GET /api/v1/setup/status` (or another pre-auth endpoint) returns the
      migration state — applied count and total — and whether SMTP is configured.
- [ ] It stays reachable **before** setup: `setup-gate` already exempts
      `/api/v1/setup/*`, and this is precisely the moment the panel is shown.
- [ ] The values are read, not assumed: applied count from the migrations table,
      total from the migrations folder, SMTP from the org row or config.
- [ ] Nothing in the response identifies the database as anything but SQLite.
- [ ] A follow-up `area: web` task is filed to render the panel from it.

## Notes / context

Discovered wiring LAI-106. **Nothing is blocked** — first boot works without the
panel, and the M1 exit path is complete.

`SystemStatus.tsx` takes `migrationsApplied`, `migrationsTotal` and
`smtpConfigured` and needs no change to accept real values; only the call site
in `FirstBootScreen` was removed.

Deliberately p3: it is a nicety on a screen each instance sees exactly once.

No new dependencies.

---

## PM decision — 2026-08-24: the payload

`GET /api/v1/setup/status` returning only `{ setup_required }` was underspecified
— §6.4 named the route and never said what it returns. Now defined there:

```
{ setup_required, system: { database, migrations_applied, smtp_configured } }
```

- **`database`** — the engine and mode, e.g. `"SQLite · WAL"`. Read from the
  live connection's PRAGMAs (LAI-003 already asserts them), never a constant. A
  hardcoded string is exactly the `postgres 16 · connected` artifact one step
  removed.
- **`migrations_applied`** — the count actually applied, from the migrator's own
  journal, not a number in a file.
- **`smtp_configured`** — boolean only. **Never the host, port or credentials**:
  this endpoint is reachable *before* anyone has authenticated, so it must say
  whether SMTP works and nothing about how it is configured.

That last point is the one to get right. A pre-auth endpoint that leaks
infrastructure detail is a reconnaissance gift, and the panel only needs a
green/amber dot.

**Your judgement was correct** — LAI-106 AC5 says hardcoded numbers on a status
panel are worse than no panel, and you left it unrendered rather than inventing
them. A panel that says "migrations 41/41" when nobody counted is a lie that
looks like diligence.
