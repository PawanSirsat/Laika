---
id: LAI-110
title: '`comment.added` is doing the work of three verbs'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-047]
discovered-from: LAI-047
status: backlog
---

## Goal

LAI-047 writes an activity row for creating, editing **and** soft-deleting a
comment. SPEC §4.8's closed vocabulary has only `comment.added`, so all three use
it and distinguish themselves in the payload:

```json
{ "action": "created" | "edited" | "deleted", "comment_id": "…" }
```

That was the right call for one task — LAI-047's notes said growing the
vocabulary is a schema change and therefore its own task — but it leaves the
audit trail saying "added" about a deletion. Anyone filtering `activity` by
`type`, which is the obvious thing to do and what every index on that table is
for, gets the wrong answer.

## Acceptance criteria

- [ ] `comment.edited` and `comment.deleted` join `ACTIVITY_TYPES` and SPEC §4.8's
      list, with a migration.
- [ ] `services/comments.ts` writes the specific verb for each mutation.
- [ ] The `action` payload field **stays** — rows written before this task keep it
      as their only distinguishing mark, and dropping it would make the history
      unreadable. Say so in a comment.
- [ ] A test asserts all three verbs, and that an existing `comment.added` row
      with `action: "deleted"` is still interpretable.
- [ ] The migration recreates the `activity` append-only triggers (see below).

## Notes / context

**Fifth instance of this pattern**, after LAI-022 (error codes), LAI-044
(`org.created`), LAI-010 (three project verbs) and LAI-011
(`task.dependency_removed`). The shape is always the same: a task is written
against a §4 section that lists *nouns*, and nobody checks that §4.8 has a *verb*
for every mutation the task performs.

LAI-107 already suggests a mechanical `enums.ts` ↔ §4.8 check. Five occurrences
is a strong argument for building it — and a better one for a check that lists,
for each service function that mutates, whether a verb exists. Worth deciding
before M3 adds the MCP tools, which mutate through the same services.

**The trigger rescue is now mandatory boilerplate.** Any change to `activity` is a
table rebuild, and SQLite drops the table's triggers with it. Migrations 0003,
0004 and 0005 each carry a byte-identical `CREATE TRIGGER` block appended by hand.
The LAI-044 test has caught the omission three times for three; it will catch a
fourth, but this is the point at which generating the block — or moving the
guarantee somewhere a rebuild cannot touch — costs less than remembering it.

No new dependencies.
