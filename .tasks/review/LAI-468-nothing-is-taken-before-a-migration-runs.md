---
id: LAI-468
title: 'Nothing is taken before a migration runs — M7 asks for migration safety on boot'
area: server
assignee: core
priority: p2
depends-on: [LAI-466]
discovered-from: LAI-466
status: review
started: 2026-09-10T01:30:00Z
finished: 2026-09-10T02:05:00Z
---

## Goal

M7 lists **"migration safety on boot"** and `runMigrations` has none:

```ts
export function runMigrations(db: Db, migrationsFolder = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
  ensureActivityTriggers(db);
  backfillTaskTimestamps(db);
}
```

**`backup.ts` takes a nightly snapshot on a schedule, and nothing takes one before
a schema change.** The riskiest moment in a self-hosted product's life is the
first boot after an upgrade, and it is the one moment with no fresh copy behind
it. **LAI-466 proved a snapshot restores; this makes sure there is one to
restore.**

## Acceptance criteria

- [x] **A snapshot is taken before any pending migration is applied**, and **only
      when there is one** — an unchanged schema on every restart must not fill the
      backup directory and push the fourteen real ones out. **Assert both:** a
      boot with pending migrations writes one, a boot without writes none.
- [x] **A failed migration leaves the pre-migration snapshot in place and says
      where it is.** The operator is reading a crash log at that moment; the path
      goes in the error, not only in the directory.
- [x] **`backfillTaskTimestamps` runs after the snapshot too.** It is not a `.sql`
      migration, but it writes, and *"idempotent by construction"* is a property of
      today's implementation rather than of the step.
- [x] **The pre-migration snapshot is named so it sorts and reads distinctly**
      from a nightly one. §11.6 keeps fourteen by filename order; **a pre-upgrade
      copy that a nightly prune can delete is the one you wanted.** Decide whether
      it is exempt from the count and say which.
- [x] **Test the failure, not only the success.** A migration that throws
      half-way, with the snapshot then restored and the app booted from it —
      LAI-466's harness already does the last two steps.
- [x] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**SQLite's DDL is transactional, so a failed migration usually rolls back** —
which is exactly why this is worth doing carefully rather than assuming it is
covered. **`migrate()` applies files in sequence**, so three of five succeeding
and the fourth failing leaves a database that is neither version. **The snapshot
is for that case, not for the single-statement one.**

**Do not add a `--no-backup` flag.** An operator who wants to skip it can move the
directory; a flag is a thing that ends up in a systemd unit and is forgotten.

---

## Submission note — CORE, 2026-09-10

**Root gate `EXIT 0`** — server 1932, `server/web` and `cli` zero failures.

### The mechanism choice, made on a measurement

**`VACUUM INTO`, not `Database.backup()`.** The nightly job uses SQLite's
*online* backup — asynchronous, built to copy while other connections write.
**Neither property is wanted at boot**, where we are the only connection and the
port is not bound. Using it would have meant making the whole boot path async,
and `freshDb()` with it, for a copy taken while nothing is online.

Measured before choosing: **2.6ms, one consistent file, no `-wal` or `-shm`
beside it**, carrying migrations, rows and triggers — the shape LAI-466 proved
restorable.

### AC1 — both directions, and the failure mode is an endless snapshot

`pendingMigrations` asks **the question the migrator asks**: drizzle records each
applied migration's journal `when` as `created_at` and applies entries newer than
the newest row. A guard that disagreed would write a file **on every boot for
ever** — and that failure looks like the feature working, which is why there is
a test asserting the two agree on a real database.

### AC4 — exempt from the fourteen, and asserted

`pre-migration-`, deliberately **not** `laika-pre-migration-`: `pruneBackups`
keeps §11.6's fourteen among files starting with `laika-`, so a prefix inside
that namespace lets the nightly prune delete exactly the copy you wanted.

The test writes `KEEP_BACKUPS + 5` nightly files, prunes, and asserts **five were
deleted and the pre-upgrade copy survived**. The property is "the prune cannot
reach this"; asserting it beats sharing a constant between two modules that use
different mechanisms.

### AC5 — the failure, and the file behind the message

Two tests. The first asserts the error **names the path** — a bare `toThrow()`
would have passed on the raw SQLite error, which names no snapshot at all, and
the whole criterion is that an operator reading a crash log learns where the copy
is. The second **restores that snapshot and reads a row back**, and asserts the
journal came across, because a path in an error is worth nothing if the file is
unusable.

Both use a fixture where `0000` succeeds and `0001` fails — the sequence case
your Notes name, not the single-statement one SQLite already rolls back.

### Five probes, all red

Snapshot on every boot; snapshot never; failure re-thrown bare; the prefix moved
into the nightly namespace; `pendingMigrations` ignoring what is applied.

### One thing that cost a round trip, and it is worth reading

My broken-migration fixture first used `when: 1, 2`. On a database that had
already migrated, **drizzle treated them as applied and the migration silently
did not run** — the test expecting a throw got none. Parameterised now, with the
reason in a comment.

**Same shape as the transcript cap's window**: a comparison against stored state
that quietly answers *"nothing to do"*. Neither failure looks like a failure —
one is a test that passes, the other is a migration that does not happen.

### Not done, per your Notes

No `--no-backup` flag. An operator who wants to skip it can move the directory.
