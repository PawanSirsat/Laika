---
id: LAI-113
title: A sprint's audit trail is filed under `project.updated`
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-050]
discovered-from: LAI-050
status: backlog
---

## Goal

§4.8's vocabulary has no sprint verb, so LAI-050 records creating, editing and
deleting a sprint as `project.updated` with
`payload: { entity: 'sprint', action, sprint_id, name }`. Deleting a sprint —
which releases every task in it — reads in the audit trail as a project settings
edit.

Moving a task in or out is fine and needs no change: it writes `task.updated`
with `{ field: 'sprint_id', from, to }`, which is exactly what happened.

## Acceptance criteria

- [ ] `sprint.created`, `sprint.updated` and `sprint.deleted` join `ACTIVITY_TYPES`
      and SPEC §4.8's list, with a migration.
- [ ] `services/sprints.ts` writes the specific verb; the `entity`/`action`
      payload **stays**, because rows written before this task have nothing else
      to distinguish them. Say so in a comment.
- [ ] A test asserts all three, and that an existing `project.updated` row with
      `entity: 'sprint'` is still interpretable.
- [ ] The migration recreates the `activity` append-only triggers.

## Notes / context

**Sixth instance** of a task needing a verb §4.8 does not have (LAI-022, LAI-044,
LAI-010, LAI-011, LAI-047, now this). LAI-110 argued the mechanical check LAI-107
proposed is worth building; six says it plainly. The check that would actually
have caught all six is not "does `enums.ts` match §4.8" but "does every mutating
service function have a verb that names what it did" — the first is a
consistency check between two lists that are already consistent, the second is
the one with the bugs in it.

Worth bundling with LAI-110 rather than doing separately: both are a migration
that rebuilds `activity`, and doing that twice means writing the trigger rescue
block twice. Whoever takes them should take both.
