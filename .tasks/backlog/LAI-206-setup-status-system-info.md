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
