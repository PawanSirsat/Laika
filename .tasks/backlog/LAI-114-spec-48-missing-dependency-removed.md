---
id: LAI-114
title: '§4.8 is missing `task.dependency_removed`'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-051
status: backlog
---

## Goal

`ACTIVITY_TYPES` in `server/src/db/enums.ts` and the `activity` CHECK constraint
both allow `task.dependency_removed` — LAI-011 added it, and migration 0005
rebuilt the table for it. SPEC §4.8's type list does not have it.

§4.8 settles which side is wrong: "**`enums.ts` and the `activity` CHECK
constraint are the enforcement**; this list is the description. If they disagree,
the constraint wins and this list is the bug." So this is a one-line documentation
fix, not a schema change.

## Acceptance criteria

- [ ] `task.dependency_removed` appears in §4.8's `Types:` list, in the same
      position as in `enums.ts` (after `task.dependency_added`).
- [ ] The `ACTIVITY_TYPE_EXEMPTIONS` entry for it is removed from
      `server/test/tooling/schema-spec-drift.test.ts` — the check fails while a
      stale exemption remains, so the removal is not optional.

## Notes / context

Found by LAI-051's drift check on its first run, which is what it was for. It is
`area: docs` because §4.8 is the thing that is wrong, but it needs a one-line edit
in `server/` too, and the drift check will not go green until both are done —
whoever takes it should be granted both files, or it should be split.

Worth noting for whoever writes the §4.8 edit: this is the **fifth** verb to go
missing from that list in one direction or the other. LAI-113 argues the check
that would catch the underlying problem is not list-vs-list — which is what
LAI-051 built and which now holds those two in step — but "does every mutating
service function have a verb naming what it did". LAI-051 closes the mechanical
half; the other half is still open.
