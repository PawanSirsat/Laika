---
id: LAI-206
title: Expose migration and SMTP state so the first-boot status panel can exist
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-106
status: review
started: 2026-09-01T14:50:00Z
finished: 2026-09-01T15:10:00Z
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

- [x] `GET /api/v1/setup/status` (or another pre-auth endpoint) returns the
      migration state — applied count and total — and whether SMTP is configured.
- [x] It stays reachable **before** setup: `setup-gate` already exempts
      `/api/v1/setup/*`, and this is precisely the moment the panel is shown.
- [x] The values are read, not assumed: applied count from the migrations table,
      total from the migrations folder, SMTP from the org row or config.
- [x] Nothing in the response identifies the database as anything but SQLite.
- [x] A follow-up `area: web` task is filed to render the panel from it.

## Notes / context

Discovered wiring LAI-106. **Nothing is blocked** — first boot works without the
panel, and the M1 exit path is complete.

`SystemStatus.tsx` takes `migrationsApplied`, `migrationsTotal` and
`smtpConfigured` and needs no change to accept real values; only the call site
in `FirstBootScreen` was removed.

Deliberately p3: it is a nicety on a screen each instance sees exactly once.

No new dependencies.

---

## CHIEF decision — 2026-08-24: the payload

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

## Outcome

`GET /api/v1/setup/status` now returns §6.4's shape:

```json
{ "setup_required": true,
  "system": { "database": "SQLite · WAL", "migrations_applied": 18, "smtp_configured": false } }
```

**LAI-158** filed to render it.

### One criterion I did not build to, and why

**AC1 and AC3 ask for a migration *total*; §6.4 has no field for one.** I read
the section rather than the description of it:

```
GET /api/v1/setup/status
     └ { setup_required, system: { database, migrations_applied, smtp_configured } }
```

The CHIEF decision appended to this task drops the total deliberately — *"the
count actually applied, from the migrator's own journal, **not a number in a
file**"* — and AC3's *"total from the migrations folder"* is exactly the number in
a file it rules out. The ACs predate the decision.

**The decision is also right, and that is checkable rather than deferential.**
`src/index.ts` runs `runMigrations(db)` at line 30 and `serve()` at line 60, and
the migrator throws rather than continuing. **A server that can answer this
request has applied all of them.** The denominator is always the numerator, so
`18/18` can never read anything else — decoration with a chance of being wrong,
which is the precise failure LAI-106 AC5 named and this task exists to avoid.

Say if you want `migrations_total` in §6.4 anyway; it is two lines here. I have
not added it, because a field that cannot vary is the thing this panel is
supposed to stop showing. **LAI-158 is told not to render `n/n` by passing
`migrationsApplied` twice**, which is the shape that mistake would take.

### Read, never asserted

- **`database`** — `SQLite · ${journal_mode}` from `readPragmas` on the live
  connection. A hardcoded `'SQLite · WAL'` is right today and is still
  `postgres 16 · connected` one step removed. The test sets
  `journal_mode = MEMORY` and requires the field to follow, so a literal fails.
- **`migrations_applied`** — `COUNT(*)` from the migrator's own
  `__drizzle_migrations`, asserted against the number of `.sql` files on disk
  rather than a number typed into the test, which would need editing on every
  migration and would then be asserting itself.
- **`smtp_configured`** — `orgs.smtp_json_enc` being non-empty. Before setup
  there is no org row, so the honest answer is `false`.

### The pre-auth constraint, asserted rather than trusted

This endpoint answers before anybody has authenticated, so the boolean is the
whole design. The test stores a recognisable blob in `smtp_json_enc` and asserts
the response body does **not** contain it, and does not match
`/smtp_json|host|port|password/i`. The key set is pinned to exactly the three
fields §6.4 names — on a pre-auth endpoint a new field is not a diff nobody
reads, it is an unauthenticated disclosure.

### Verification

Seven tests. Four mutations, each confirmed landed:

| mutation | result |
| --- | --- |
| hardcode `'SQLite · WAL'` (right today, still a constant) | red |
| report SMTP configured whenever an org row exists | red |
| return a literal `41` for the migration count — the number this task warns about | red |
| add `smtp_host` to the payload | red — 2 tests, including the leak assertion |

I re-ran the fourth after retyping the test helper, rather than assume a typing
change left it catching.

### One existing assertion narrowed

`leaves no orphan account behind when the second call loses` did
`toEqual({ setup_required: false })` on this response. It now asserts
`setup_required` specifically — the `system` panel rides along on the same
response and is covered in its own describe.

### A note on how this file reached review

The frontmatter edit and this section **failed to apply on the first attempt**
and the commit landed anyway: my script aborted on a bad anchor, and the `&&`
chain after it did not stop. The file arrived in `.tasks/review/` still saying
`status: backlog`, `assignee: unclaimed`, with nothing ticked.

Reading it back out of the commit is what caught it — the §2 rule, earning its
place for the third time today. Worth recording because the failure mode is new:
not `git mv` staging a pre-edit blob, but **an edit that never ran at all** while
the move around it succeeded.

### Gate

`@laika/server` **1719/1719**, `cli` 19/19, `pnpm lint` EXIT=0, `pnpm format`
EXIT=0. **`server/web` is red on one assertion and it is LAI-208's**
(`TaskView.stale_flagged_at`), clearing when LAI-157 lands.

No new web failure — and that is worth naming rather than resting on:
`SetupStatusBody` is **not** a `*View`, so LAI-213's mirror check does not cover
it. **The client's status type can drift from this one and nothing would
notice.** It is LAI-158's third criterion rather than an implicit hope.
