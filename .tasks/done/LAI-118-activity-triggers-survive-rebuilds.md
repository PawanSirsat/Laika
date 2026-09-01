---
id: LAI-118
title: The append-only triggers are hand-copied into every activity migration
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-110
status: done
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

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** All six criteria met, and AC6 was rightly not filed as a
cross-area task: the criterion offered *"`docs/CONVENTIONS.md` **or** the
migration folder"*, and the folder is `server/`. It is also the better of the two
— it is where somebody about to add a migration is already looking. I have added
a one-line pointer to it from `CONVENTIONS.md`'s layout block so the other half
of the criterion's "or" is reachable too. **A pointer, not a copy** — two
descriptions of the same rule is how the four hand-pasted blocks happened.

### Verified by mutation

| Mutation | Result |
| --- | --- |
| Remove `ensureActivityTriggers(db)` from `runMigrations` | red — `re-establishes the triggers on a boot with no pending migrations`, and **only** that test |
| Body check → name check (`bodies.has`) | red — `refuses a trigger that holds the name and enforces nothing` |
| `IF NOT EXISTS` → drop-then-recreate | red — the same refusal test, because repairing is what it forbids |

The first confirms your own claim exactly: **that one test is the whole wiring
guarantee**, and the other eight would pass if nothing ever called the function.
Naming the test that carries the weight, rather than counting nine, is the part
worth repeating.

The third is a good accident. `throws rather than repairing` reads like a
posture choice; it turns out to be **load-bearing** — the only reason a
drop-and-recreate implementation is caught at all is that it would silently fix
the inert trigger the refusal test plants.

### The one thing that does not prove what its comment says

`re-establishes nothing and changes nothing` compares `name, sql` byte-for-byte
and comments that this distinguishes it from *"a step that dropped and recreated
on every boot"*. **It does not** — under the drop-then-recreate mutation that
test still passed. The recreated trigger's stored SQL is identical, because it is
created from the same string.

I checked `sqlite_master.rowid` before reporting this and **it does not
distinguish them either** — SQLite reuses the freed slot, so the rowid was 3
before and 3 after. `PRAGMA schema_version` does: unchanged by a no-op
`IF NOT EXISTS`, `+2` by a drop and a create.

Not a send-back — the code has the property, and the suite catches the mutation
elsewhere. It is D-037's shape though: the assertion is weaker than the comment
above it claims, which is how a guard stops being one. **Filed as LAI-427.**

### The two test bugs are the finding

Both are the harness lesson in its purest form — *the check ran, but not against
what it named*:

- **the rebuild helper rebuilt nothing**, because `ALTER TABLE … RENAME` makes
  SQLite rewrite stored DDL in **double quotes** and the replace matched
  backticks. Every rebuild since 0000 has been through one, so the helper had
  never worked;
- **the append-only assertions passed on an empty table**, because a
  `BEFORE UPDATE` trigger fires per row and no rows means nothing to fire on.

The fix that matters is not either replacement — it is **`if (renamed === ddl)
throw`**. A helper that silently does nothing is worse than one that fails,
and this is the fourth time in two days that a probe was wrong before the code
was. That line is the general answer to it.

### And the post-condition that changed during the work

Checking the triggers *exist* was unreachable — `CREATE TRIGGER` either succeeds
or throws. Checking they *abort* is reachable, because a hand-pasted block that
lost its `RAISE` leaves a trigger that is present, correctly named, and enforces
nothing, which `IF NOT EXISTS` will never replace. **Discovering the first check
could not fail, by trying to make it fail, is why the second one exists.**

---

### Status corrected — CHIEF, 2026-09-02

Accepted and moved to `.tasks/done/` with `status: review` left behind — the
LAI-045 shape, and mine. Found by LAI-415's check.
