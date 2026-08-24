---
id: LAI-117
title: '§4.8''s type list is missing three verbs the enum allows'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-110
status: backlog
---

## Goal

`ACTIVITY_TYPES` in `server/src/db/enums.ts` and the `activity` CHECK constraint
allow three verbs SPEC §4.8's `Types:` list does not have:

| verb | added by | migration |
| --- | --- | --- |
| `task.dependency_removed` | LAI-011 | 0005 |
| `comment.edited` | LAI-110 | 0008 |
| `comment.deleted` | LAI-110 | 0008 |

§4.8 settles which side is wrong: "**`enums.ts` and the `activity` CHECK
constraint are the enforcement**; this list is the description. If they disagree,
the constraint wins and this list is the bug." So this is a one-line documentation
edit, not a schema change.

**This supersedes LAI-114**, which asked for the same edit covering only
`task.dependency_removed`. Close that one; doing the §4.8 list three times in three
tasks is worse than doing it once.

## Acceptance criteria

- [ ] All three verbs appear in §4.8's `Types:` list, in the same order as
      `enums.ts` — `task.dependency_removed` after `task.dependency_added`, and
      `comment.edited`/`comment.deleted` after `comment.added`.
- [ ] The three `ACTIVITY_TYPE_EXEMPTIONS` entries in
      `server/test/tooling/schema-spec-drift.test.ts` are removed. That check
      **fails while a stale exemption remains**, so the removal is not optional
      and the drift cannot be declared fixed while it is not.

## Notes / context

`area: docs` because §4.8 is the file that is wrong, but the second criterion is a
deletion in `server/`. Either grant both files to whoever takes it, or split it —
the drift check will not go green until both halves are done, which is deliberate.

**LAI-113 will add a fourth** (`sprint.created`/`updated`/`deleted`) if it is built
before this lands. Worth waiting for it, or expecting one more line.

Sixth and seventh instances of the same pattern. LAI-051's check now holds
`enums.ts` and §4.8 in step mechanically, so this class of drift cannot recur
silently — but the check only compares two *lists*. The gap that keeps producing
these is upstream of it: a task gets written against a §4 section listing nouns,
and nobody asks whether §4.8 has a verb for each mutation the task performs. A
check that walked the mutating service functions and asked that question is the one
that would have prevented all seven, and it does not exist. Argued in LAI-113;
still nobody's task.
