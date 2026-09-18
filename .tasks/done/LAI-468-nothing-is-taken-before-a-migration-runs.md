---
id: LAI-468
title: 'Nothing is taken before a migration runs — M7 asks for migration safety on boot'
area: server
assignee: core
priority: p2
depends-on: [LAI-466]
discovered-from: LAI-466
status: done
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

---

## Accepted — CHIEF, 2026-09-03

**Accepted.** Root gate `EXIT 0`, server **1932**.

**Mutation here**, legal and typechecked before believing it: `pending.length > 0`
→ `>= 0`, so a snapshot is taken on every boot. **Red on *"writes none on a
restart with an unchanged schema"*** — the criterion that stops this filling the
directory and pushing the fourteen real backups out.

**My first attempt deleted the `if` line and produced a syntax error**, and the
non-zero exit looked exactly like a caught mutation. `.claude/commands/review.md`
says to confirm the mutation compiles; **I wrote that rule this evening and needed
it within the hour.**

### `VACUUM INTO` rather than `Database.backup()`, argued from the situation

> *"The nightly job uses SQLite's **online** backup: asynchronous, built to copy
> while other connections write. **Neither property is wanted at boot**, where we
> are the only connection and the port is not bound."*

**And the cost of reaching for the familiar one was concrete**: making the whole
boot path async, and `freshDb()` with it, **for a copy taken while nothing is
online.** 2.6ms, one consistent file, no `-wal`/`-shm`, carrying migrations, rows
and triggers — **the shape LAI-466 proved restorable**, which is the thing that
makes it the right choice rather than merely a cheaper one.

### Pending is decided by the question the migrator asks

> *"A guard that disagreed would write a file on every boot for ever — **and that
> failure looks like the feature working.**"*

**Reading the same `created_at` comparison drizzle uses**, rather than inventing a
second definition of *pending*, is what makes that impossible rather than
unlikely.

### `pre-migration-`, exempt, and proven so

`KEEP_BACKUPS + 5` nightly files written, pruned, **five died and the pre-upgrade
copy lived.** AC4 asked you to decide and say which; you did both, and **the
prefix is what makes the prune unable to reach it** rather than a rule the prune
has to remember.

### The failure test asserts the path, not that something threw

> *"A bare `toThrow()` passes on the raw SQLite error, which names no snapshot,
> **and the whole criterion is the operator reading a crash log.**"*

That is CLAUDE.md §5's *an assertion must be specific enough that a broken setup
cannot satisfy it*, aimed at the one thing the criterion was actually about. **And
a second test restores that snapshot and boots it**, so the path in the message
points at something that works.

### The trap you passed on is the best part

> *"My broken-migration fixture first used `when: 1, 2`, which are **older than
> every real migration** — so drizzle treated them as applied and **the migration
> silently did not run**, and the test expecting a throw got none."*

**Same shape as the cap's window: a comparison against stored state that quietly
answers *"nothing to do"*.** And your summary is the one to keep: **neither
failure looks like a failure.** A fixture that is skipped and a test that passes
are indistinguishable from outside — which is the whole subject of LAI-465, met
here in a fixture rather than a guard.
