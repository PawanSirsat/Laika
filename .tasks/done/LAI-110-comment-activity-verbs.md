---
id: LAI-110
title: '`comment.added` is doing the work of three verbs'
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-047]
discovered-from: LAI-047
status: done
started: 2026-08-24T12:06:36+05:30
finished: 2026-08-24T12:14:02+05:30
reviewed: 2026-08-24T14:30:00+05:30
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
      **`ACTIVITY_TYPES` and the migration: done. §4.8's list: `docs/` is PM's, so
      filed as LAI-117 rather than edited — see the notes.**
- [x] `services/comments.ts` writes the specific verb for each mutation.
- [x] The `action` payload field **stays** — rows written before this task keep it
      as their only distinguishing mark, and dropping it would make the history
      unreadable. Say so in a comment.
- [x] A test asserts all three verbs, and that an existing `comment.added` row
      with `action: "deleted"` is still interpretable.
- [x] The migration recreates the `activity` append-only triggers (see below).

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

---

## Notes at review — builder-a

**731 tests** (5 new, 1 rewritten); format, lint, typecheck clean, suite run
twice. Verified against the **built** server:

```
delete                    204
audit trail, by verb      seq 4  comment.added    action=created
                          seq 5  comment.edited   action=edited
                          seq 6  comment.deleted  action=deleted
GET /activity by type     comment.deleted → 1 row, comment.added → 1 row
triggers after 0008       both present; UPDATE and DELETE refused
```

Filtering `activity` by `type` now gives the right answer, which was the whole
complaint.

**1. AC1 is deliberately left unticked, and here is exactly why.** It has two
halves. `ACTIVITY_TYPES` and migration `0008_comment_activity_verbs.sql` are done.
**§4.8's list is `docs/SPEC.md`, which is yours** under CLAUDE.md §1, so I did not
edit it — filed as **LAI-117** instead, with the exact edit spelled out.

LAI-117 covers **all three** verbs §4.8 is now missing
(`task.dependency_removed` from LAI-011, plus these two) and **supersedes
LAI-114**, which asked for the same one-line region covering only the first.
Recommend closing LAI-114. Doing that edit in three separate tasks is worse than
doing it once.

LAI-051's check refused to go green until I recorded this: the two verbs are in
`ACTIVITY_TYPE_EXEMPTIONS` naming LAI-117, and removing those entries is an
acceptance criterion *of* LAI-117 — so the drift cannot be declared fixed while
the doc is not.

**2. The `action` payload stays, and the reason is sharper than "for
compatibility".** Rows written before this task carry `action` as their *only*
distinguishing mark: their `type` says `comment.added` whatever actually happened.
Dropping the field would make that history unreadable — an audit trail that loses
its old entries when the vocabulary grows is not an audit trail. New rows carry
both, which costs a few bytes and gives one payload shape across the table. A test
writes a pre-LAI-110-shaped row and asserts both eras stay interpretable from the
payload; dropping the field fails two tests.

**3. Fourth migration to hand-paste the trigger block. Filed as LAI-118.** Removing
the block from 0008 fails four tests, so LAI-044's guard still works — but four for
four is the argument, not the reassurance. LAI-118 proposes the invariant move to
`runMigrations` (apply migrations, then re-establish the triggers), and it records
why **`CREATE TRIGGER IF NOT EXISTS` is not enough**: after a rebuild the trigger
does not exist, so the guard is a no-op in precisely the case that matters. It also
records the alternative I rejected — moving the guarantee into application code —
since the triggers exist to survive code that bypasses `db/activity.ts`.

**4. A rebuild renumbering `activity.rowid` would break the SSE cursor, so I
tested it.** §11.5 and the activity feed use `rowid` as their monotonic `seq`, and
`0008` is an `INSERT…SELECT` into a new table. The values come out unchanged —
there is no `ORDER BY`, no `WHERE`, and no deletions to leave gaps — and there is
now a test pinning it. An `ORDER BY created_at DESC` or a `WHERE` added to a future
rebuild fails it.

**That test took three attempts to make able to fail**, which is worth telling you
because the first two looked fine: with equal timestamps an `ORDER BY` is a no-op,
and with *descending* timestamps a `DESC` sort reproduces the scan order exactly.
Only ascending timestamps plus an assertion that pins *which row* holds each seq
actually catches it. Same failure mode as the keepalive you caught earlier —
I wrote a comment claiming "this fails if X" and had to run X to find out it
didn't.

**5. One existing test was rewritten, not just extended.** LAI-047's
`writes exactly one row per mutation, distinguished by payload action` asserted
that all three mutations wrote `comment.added`. That claim is now false, so it
became an assertion about the half that did not change — one row per mutation, in
order — with the verb question moved to the new block.

## Review — PM, 2026-08-24

**Accepted.** `comment.edited` and `comment.deleted` join the §4.8 vocabulary, so
filtering `activity` by `type` finally gives the right answer — the wart you
flagged six tasks running is closed.

**The part I checked hardest** is LAI-044's concern: adding values to a CHECK
constraint forces a table rebuild in SQLite, which silently drops triggers.
Migration 0008 recreates both append-only triggers, and
`test/db/activity.test.ts` asserts UPDATE and DELETE are still refused **at the
database**. Full suite green, so the rebuild did not cost the immutability
guarantee.
