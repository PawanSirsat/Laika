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

- [ ] **Seven verbs** join `ACTIVITY_TYPES` and §4.8's list, in one migration:
      `sprint.created`, `sprint.updated`, `sprint.deleted`, `sprint.tasks_changed`,
      `project.context_updated`, `unlisted.promoted`, `unlisted.dismissed`.
      **§4.8's half is CHIEF's and is written and held** — applied in the merge,
      so `schema-spec-drift.test.ts` is red on your branch until then. **Quote
      the failure in this file and submit red (D-045).** Do not exempt it.
- [ ] `services/sprints.ts`, the context write and the unlisted triage writes each
      emit the specific verb; the `entity`/`action` payload **stays**, because
      rows written before this task have nothing else to distinguish them. Say so
      in a comment at each site, not once.
- [ ] A test asserts every new verb, and that an existing `project.updated` row
      with `entity: 'sprint'` is **still interpretable** — the old rows are the
      point, not a leftover.
- [ ] **No backfill, and a comment saying why.** `activity` is append-only in both
      directions, so old rows keep the verb they were written with and a reader of
      old history needs `payload.action`. That is the honest cost of having had
      the vocabulary wrong; rewriting history to hide it would break the one
      property the table exists to have. **The instinct to backfill so a `type`
      filter returns complete history is reasonable and wrong** — write it where
      the next person meets the reasoning before the temptation.
- [ ] **The migration does not carry a `CREATE TRIGGER` rescue block.** LAI-118
      made that unnecessary: `runMigrations` calls `ensureActivityTriggers` after
      every pass and verifies the triggers *abort* rather than merely exist. Read
      `src/db/migrations/README.md` first. **This is the first migration since
      LAI-118, so it is also the proof** — if the triggers are not there after it,
      LAI-118 did not work.

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

---

## Widened and authorised — CHIEF, 2026-09-01

**Seven verbs, not three.** The three features named below are one decision about
§4.8's vocabulary, one SPEC change and one migration; splitting them means doing
the same review three times. `sprint.tasks_changed` is one verb for assigning
into and removing from a sprint — both answer *"what moved in or out"* and the
payload carries which, so splitting them would give two verbs no reader
distinguishes.

**The test each one had to pass is the one `project.archived` already passed:**
could a reader answer *"when did this happen?"* without inspecting a payload?
*"When was this sprint deleted?"*, *"when did the brief last change?"* and *"who
dismissed that note?"* all failed it.

**§4.8's text is written and held**, as the last note explains — growing the
vocabulary is structurally CHIEF-then-builder, because
`schema-spec-drift.test.ts` pins `ACTIVITY_TYPES` against §4.8 in both
directions and `docs/` is mine. That guard is working as designed and is not to
be worked around; **D-045 is now the procedure for it** rather than an
improvisation, which it was the last three times.
