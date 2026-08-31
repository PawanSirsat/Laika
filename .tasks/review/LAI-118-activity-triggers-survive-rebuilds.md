---
id: LAI-118
title: The append-only triggers are hand-copied into every activity migration
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-110
status: review
started: 2026-09-01T16:15:00Z
finished: 2026-09-01T16:45:00Z
---

## Goal

§4.8's append-only guarantee is enforced by two SQLite triggers. Any change to
`activity` — every vocabulary growth so far — rebuilds the table, and SQLite drops
a table's triggers with the table. `drizzle-kit` does not know the triggers exist,
so **every such migration must carry a hand-pasted copy of the `CREATE TRIGGER`
block or the guarantee silently ends there.**

Four migrations now carry a byte-identical copy: 0003, 0004, 0005, 0008. Four for
four. LAI-044's test has caught the omission every time, which is the only reason
this has never shipped — but a guarantee that depends on remembering to paste
twenty lines is one bad afternoon from being gone.

## Acceptance criteria

- [x] The triggers are (re)established by something that runs **after** migrations,
      not by each migration. `runMigrations` in `src/db/migrate.ts` is the obvious
      home: apply the pending migrations, then assert the invariant.
- [x] Idempotent — booting an already-migrated database re-establishes nothing and
      changes nothing.
- [x] **`CREATE TRIGGER IF NOT EXISTS` is not sufficient on its own** and the task
      should say why in a comment: after a rebuild the trigger does not exist, so
      the guard is a no-op in exactly the case that matters. The mechanism has to
      run unconditionally after every boot's migration pass.
- [x] Proved the way the problem actually appears: a test that rebuilds `activity`
      *without* a rescue block, runs the invariant step, and finds the triggers
      back. Deleting the invariant step must fail it.
- [x] The four hand-pasted blocks in 0003/0004/0005/0008 stay. Applied migrations
      are history and editing them changes a file whose hash drizzle records; the
      new mechanism only has to make future ones unnecessary.
- [x] A note in `docs/CONVENTIONS.md` or the migration folder saying the block is no
      longer needed — otherwise the next person copies it anyway. **`docs/` is CHIEF's**,
      so file that half rather than editing it.

## Notes / context

Alternative considered and worth writing down if rejected again: **do not** move
the guarantee into application code. `db/activity.ts` already exposes no mutation
path, and the triggers exist precisely so the guarantee survives code that
bypasses that module — a `DELETE` typed into a SQLite shell, or a future service
that imports the table directly. Replacing the triggers with a code-level check
would trade a real guarantee for a convention.

Related: LAI-110 added a test asserting a rebuild does not renumber `activity`'s
`rowid`, which the SSE stream (§11.5) and the activity feed use as their cursor.
Whoever builds the invariant step should read it — the two concerns meet in the
same migrations.


---

## Submitted — CORE, 2026-09-01

`runMigrations` calls `ensureActivityTriggers` after the migration pass, on
**every** boot. 9 new tests in `server/test/db/migrate.test.ts`; suite 1420
green, lint and format clean. **All six criteria are ticked, including the last
one — see below.**

### AC6 needed no cross-area filing

The criterion offers `docs/CONVENTIONS.md` **or the migration folder**. The
folder is `server/`, so `src/db/migrations/README.md` is mine to write, and it is
where somebody about to add a migration actually looks. Nothing is blocked on
CHIEF.

### The post-condition changed during the work, and that is the finding

I first checked the triggers **existed**. Mutation-testing it caught nothing:
`CREATE TRIGGER` either succeeds or throws, so a name check is unreachable and
was decoration that looked like protection.

The reachable failure is the one `IF NOT EXISTS` **cannot see**. The block has
been hand-pasted into four migrations; a paste that lost its `RAISE` leaves a
trigger that is present, correctly named, and enforces nothing — and
`IF NOT EXISTS` will never replace it, because something holds the name. So the
check now reads each trigger's stored SQL for the clause that does the work, and
there is a test that plants an inert trigger and expects a refusal.

**It throws rather than repairing.** A missing trigger is an accident of how
SQLite rebuilds tables and creating it is the fix; a wrong one is a mistake in a
migration, and rewriting it at boot would hide a file that will be applied again
on the next clean install.

### Two test bugs, both the same class

- **The rebuild helper rebuilt nothing.** It renamed `` `activity` `` in the
  captured DDL, but SQLite rewrites stored DDL in **double quotes** on
  `ALTER TABLE … RENAME`, and every rebuild since 0000 has gone through one. The
  replace matched nothing and the test asserted on a table it had not touched.
  It now matches either form and **throws if the replacement did not land**.
- **The append-only assertions passed on an empty table.** A `BEFORE UPDATE`
  trigger fires *per row*; with no rows the statement matches nothing and
  succeeds whether or not the guarantee exists. The tests seed a row first.

Both are the harness lesson again: the check ran, but not against what it named.

### One test that would otherwise have been missing

Every other test calls `ensureActivityTriggers` directly and would pass just as
well if **nothing ever called it**. `re-establishes the triggers on a boot with
no pending migrations` is the one that fails when the wiring is removed, and it
is also the property that matters — a migration runs once and cannot repair a
database a later migration rebuilt.

### Not done, deliberately

`db/migrate.ts` loses its `NO_MIRROR_REQUIRED` exemption — "asserted by every db
test, which applies migrations" stopped being true the moment it held an
invariant of its own.

The four hand-pasted blocks are untouched (`git status` on
`src/db/migrations/` is empty).

Seven mutations, all caught, including the two that initially were not.
