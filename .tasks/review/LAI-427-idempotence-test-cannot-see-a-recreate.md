---
id: LAI-427
title: The trigger idempotence test cannot see a drop-and-recreate
area: server
assignee: core
priority: p3
depends-on: [LAI-118]
discovered-from: LAI-118
status: review
started: 2026-09-01T17:45:00Z
finished: 2026-09-01T18:00:00Z
---

## Goal

`re-establishes nothing and changes nothing` in `server/test/db/migrate.test.ts`
compares `sqlite_master`'s `name, sql` before and after two calls to
`ensureActivityTriggers`, and carries this comment:

> Byte-identical, not merely two of them: a step that dropped and recreated on
> every boot would also "pass" a count, while churning `sqlite_master` and
> changing the triggers' identity for no reason.

**It cannot see that.** Replacing the `IF NOT EXISTS` loop with a
`DROP TRIGGER` + `CREATE TRIGGER` pair leaves this test green, because the
recreated trigger's stored SQL is byte-identical — it is created from the same
string constant. Verified during LAI-118's review.

The mutation *is* caught, by `refuses a trigger that holds the name and enforces
nothing` — a drop-and-recreate repairs the inert trigger that test plants. So the
suite is not blind; **this test is**, and its comment says otherwise.

## Why it is worth fixing rather than deleting the comment

D-037: a guard may assert a property, never a contingent fact — and the sibling
failure is a guard whose comment claims more than its assertion does. The next
person to change `ensureActivityTriggers` will read the comment, believe
idempotence is pinned here, and it is pinned somewhere else for an unrelated
reason. The unrelated reason could be removed by a later task in good faith.

## Notes / context

**`sqlite_master.rowid` is not the fix.** It was my first instinct and it is
wrong: SQLite reuses the freed slot, so a dropped-and-recreated trigger comes
back with the same rowid. Checked before filing.

**`PRAGMA schema_version` is.** Any schema change bumps it; a no-op
`CREATE TRIGGER IF NOT EXISTS` does not:

```
CREATE TRIGGER IF NOT EXISTS t1 …            schema_version 2
CREATE TRIGGER IF NOT EXISTS t1 …  (no-op)   schema_version 2
DROP TRIGGER t1; CREATE TRIGGER t1 …         schema_version 4
```

## Acceptance criteria

- [x] The test asserts something a drop-and-recreate fails. Prove it the way
      LAI-118 was proved: make `ensureActivityTriggers` drop and recreate, and
      confirm **this** test goes red — not only the refusal test.
- [x] The comment describes what the assertion actually checks.
- [x] Keep the byte-identical `name, sql` comparison as well. It is the check
      that a future edit did not change the trigger *bodies*, which is a
      different property and worth having.


---

## Submitted — CORE, 2026-09-01

**Your diagnosis was exactly right, including the part about `rowid`.** Suite
1429 green, lint and format clean.

### Verified rather than trusted

I ran the three cases before writing anything, because the whole defect was a
comment claiming a property nobody had checked:

```
CREATE TABLE                                 schema_version 1
CREATE TRIGGER IF NOT EXISTS t1 …                           2
CREATE TRIGGER IF NOT EXISTS t1 …  (no-op)                  2
DROP TRIGGER t1; CREATE TRIGGER t1 …                        4
```

And `sqlite_master.rowid` after the drop-and-recreate: **2**, the same slot. It
is the obvious instrument and it is wrong, exactly as you said.

### Proved in both directions

The criterion asks that a drop-and-recreate fail **this** test:

- With the new assertion, making `ensureActivityTriggers` drop and recreate turns
  `re-establishes nothing and changes nothing` red. Previously only
  `refuses a trigger that holds the name and enforces nothing` caught it — for an
  unrelated reason a later task could remove in good faith.
- Removing **only** the `schema_version` line under the same mutation turns it
  green again. So the byte-identical comparison was genuinely blind rather than
  merely redundant, which is the half that would otherwise have been assumed.

### The `name, sql` comparison stays

It checks that a future edit did not change the trigger *bodies* — a different
property, and worth having. The comment now names which line checks which, which
is the actual fix: the old one described one assertion and there were two
properties.

### What I take from it

The defect was not the test, it was **a comment that made a claim the code under
it did not support** — and it was mine, written while I was being careful about
exactly that class of thing on the same task. A guard that overstates itself is
worse than no comment, because the next person stops looking.
