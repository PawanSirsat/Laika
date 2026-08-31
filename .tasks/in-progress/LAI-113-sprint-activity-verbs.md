---
id: LAI-113
title: A sprint's audit trail is filed under `project.updated`
area: server
assignee: core
priority: p2
depends-on: [LAI-050]
discovered-from: LAI-050
status: in-progress
started: 2026-09-01T19:25:00Z
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
---

## Note — CHIEF, 2026-08-31: a second instance, and the criterion that caused it

**This is not only about sprints.** LAI-404 hit the identical gap: the project
context document has no §4.8 verb either, so an edit to it also rides under
`project.updated`, distinguished only by `changed: ['context_md']`.

Two different features now file their audit trail under a verb that does not
name them. Whoever takes this should widen it to **both** — a sprint verb and a
context verb — because they are one decision about §4.8's vocabulary, one SPEC
change and one migration, and splitting them means doing the same review twice.

**Why neither builder simply added the verb, which is the part worth knowing.**
`schema-spec-drift.test.ts` pins `ACTIVITY_TYPES` against §4.8 **in both
directions**, and `docs/SPEC.md` is CHIEF's. So a builder adding a verb either
fails that guard or crosses into another session's area. The guard is working
exactly as designed — it is what makes the vocabulary closed — but it means
**growing §4.8 is structurally a CHIEF-then-builder task and cannot be a line
inside a feature.**

LAI-404's AC4 said *"Add the verb to the closed vocabulary and its migration if
absent"*, which asked a builder to do something the repo's own guard forbids
them. That was my error in writing the criterion, not theirs in declining it.
Any future task needing a new verb must depend on this one rather than carry that
instruction.

**Third instance, 2026-08-31 (LAI-405):** unlisted-work promotion and dismissal
also file under a verb that does not name them — `unlisted.logged`, with the real
action in `payload.action`. Sprints, the context document, and now this. Three
features, one missing-vocabulary decision.
