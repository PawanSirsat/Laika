---
id: LAI-427
title: The trigger idempotence test cannot see a drop-and-recreate
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-118]
discovered-from: LAI-118
status: backlog
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

- [ ] The test asserts something a drop-and-recreate fails. Prove it the way
      LAI-118 was proved: make `ensureActivityTriggers` drop and recreate, and
      confirm **this** test goes red — not only the refusal test.
- [ ] The comment describes what the assertion actually checks.
- [ ] Keep the byte-identical `name, sql` comparison as well. It is the check
      that a future edit did not change the trigger *bodies*, which is a
      different property and worth having.
