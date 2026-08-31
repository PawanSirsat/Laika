---
id: LAI-118
title: The append-only triggers are hand-copied into every activity migration
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-110
status: backlog
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

- [ ] The triggers are (re)established by something that runs **after** migrations,
      not by each migration. `runMigrations` in `src/db/migrate.ts` is the obvious
      home: apply the pending migrations, then assert the invariant.
- [ ] Idempotent — booting an already-migrated database re-establishes nothing and
      changes nothing.
- [ ] **`CREATE TRIGGER IF NOT EXISTS` is not sufficient on its own** and the task
      should say why in a comment: after a rebuild the trigger does not exist, so
      the guard is a no-op in exactly the case that matters. The mechanism has to
      run unconditionally after every boot's migration pass.
- [ ] Proved the way the problem actually appears: a test that rebuilds `activity`
      *without* a rescue block, runs the invariant step, and finds the triggers
      back. Deleting the invariant step must fail it.
- [ ] The four hand-pasted blocks in 0003/0004/0005/0008 stay. Applied migrations
      are history and editing them changes a file whose hash drizzle records; the
      new mechanism only has to make future ones unnecessary.
- [ ] A note in `docs/CONVENTIONS.md` or the migration folder saying the block is no
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
