---
id: LAI-113
title: A sprint's audit trail is filed under `project.updated`
area: server
assignee: core
priority: p2
depends-on: [LAI-050]
discovered-from: LAI-050
status: done
started: 2026-09-01T19:25:00Z
finished: 2026-09-01T20:10:00Z
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

- [x] **Seven verbs** join `ACTIVITY_TYPES` and §4.8's list, in one migration:
      `sprint.created`, `sprint.updated`, `sprint.deleted`, `sprint.tasks_changed`,
      `project.context_updated`, `unlisted.promoted`, `unlisted.dismissed`.
      **§4.8's half is CHIEF's and is written and held** — applied in the merge,
      so `schema-spec-drift.test.ts` is red on your branch until then. **Quote
      the failure in this file and submit red (D-045).** Do not exempt it.
- [x] `services/sprints.ts`, the context write and the unlisted triage writes each
      emit the specific verb; the `entity`/`action` payload **stays**, because
      rows written before this task have nothing else to distinguish them. Say so
      in a comment at each site, not once.
- [x] A test asserts every new verb, and that an existing `project.updated` row
      with `entity: 'sprint'` is **still interpretable** — the old rows are the
      point, not a leftover.
- [x] **No backfill, and a comment saying why.** `activity` is append-only in both
      directions, so old rows keep the verb they were written with and a reader of
      old history needs `payload.action`. That is the honest cost of having had
      the vocabulary wrong; rewriting history to hide it would break the one
      property the table exists to have. **The instinct to backfill so a `type`
      filter returns complete history is reasonable and wrong** — write it where
      the next person meets the reasoning before the temptation.
- [x] **The migration does not carry a `CREATE TRIGGER` rescue block.** LAI-118
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


---

## Submitted — CORE, 2026-09-01 (§4.4 step 1 / D-045)

`@laika/server` **1437 of 1438**; the one failure is yours. Lint and format
clean.

### The red, quoted and mapped

```
server/test/tooling/schema-spec-drift.test.ts
  × lists every activity type the enum allows          → CHIEF's §4.8, at merge

server/web/test/api/use-events.test.ts:22
  not ok 1 - STREAM_TYPES equals ACTIVITY_TYPES, in order              → LAI-147
server/web/test/routes/screens/dashboard/dashboard-derive.test.ts:208
  not ok 2 - covers every verb the server can write                    → LAI-147

server/web/test/api/view-type-drift.test.ts
  not ok 2 - no server field is missing from its client type    → LAI-429/LAI-121
  not ok 3 - the client declares nothing the server does not send      → LAI-429
```

The last two are LAI-099's and LAI-126's, already on this branch and already
reported. **The two new ones are this task's, and they were not predicted.**

### LAI-113 is a two-owner change — I have filed the other half as LAI-147

Your note said *"root `pnpm test` should otherwise be genuinely green: no `*View`
type moves."* That is true and it is not sufficient. **The client also mirrors
`ACTIVITY_TYPES`** — `server/web/src/api/stream-types.ts` keeps `STREAM_TYPES` in
the same order, and the dashboard asserts it handles every verb the server can
write. Both are SHELL's, both have their own test, and both went red the moment
the vocabulary grew.

**This is a drift axis LAI-213 does not cover.** LAI-213 binds client view types
to server `*View` types; this is a *closed vocabulary shared on both sides*, a
different mirror with its own guards. So the question *"will this land green?"*
is not answered by *"does a `*View` move?"* — it is answered by *"does anything
closed on the server have a copy on the client?"*, and `ACTIVITY_TYPES` does.

Not exempted, not crossed into. LAI-147 has the two failing tests verbatim and
leaves the UI judgement — whether `sprint.tasks_changed` is worth rendering — to
SHELL, since one row per task moved may be noise in a feed a person reads.

### LAI-118's proof: it works

The migration **rebuilds `activity`** (`DROP TABLE` + `RENAME`), contains **zero
`CREATE TRIGGER` statements**, and after `runMigrations` on a fresh database both
triggers are present and the new verbs are in the `CHECK`. First migration since
LAI-118, and the first in this repo's history that did not need the block pasted
into it.

### The find is what not backfilling costs, and who pays it

I wrote the no-backfill reasoning into `enums.ts` as you asked. Then
`project-context`'s tests failed for a reason I had not anticipated:
**`latestFieldEdit` filtered on `project.updated`.**

Leaving it would have silently lost every context edit made before the rename,
and the symptom — *"the document says it was last edited by nobody"* — looks
nothing like its cause. It now accepts **both** verbs, permanently, with a
comment saying that is the cost of the rename paid in the open rather than hidden
by a backfill.

**That is the concrete form of your instruction.** "Do not rewrite history" is
easy to agree with; "therefore every reader of that history must accept two
vocabularies for ever" is the part with the bug in it, and it was only visible
because a test read the old rows.

A mutation dropping *either* verb from that reader goes red.

### Also fixed

`activity-payload-names`'s sweep reached `unlisted.logged` only as a side-effect
of promote and dismiss. Now that those have their own verbs it had no producer,
so the sweep calls `logUnlistedWork` directly — all three covered by their own
path rather than one by accident.

Five mutations, all caught: the reader dropping the old verb, the reader dropping
the new one, sprints reverting to `project.updated`, the `entity`/`action` payload
dropped as redundant, and promote sharing `unlisted.logged` again.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** §4.8's half applied in the landing: nine verbs (LAI-222's two ride
with them) and the prose for **why `sprint.tasks_changed` is one verb and the two
deactivation verbs are two** — both directions of a sprint move answer the same
reader question, *"who was locked out"* and *"who was let back in"* do not.

**Verified by mutation, both directions.** Dropping `project.context_updated`
from `latestFieldEdit` goes red on two tests; dropping `project.updated` goes red
on `finds a context edit written under either verb`. Either alone would have been
a guard that cannot fail in the direction that matters.

**Migration `0012` rebuilds `activity` with zero `CREATE TRIGGER` statements and
the triggers are there afterwards.** LAI-118's proof, and it passed: *"four for
four became four for five, the other way."*

### The finding is what the rule costs, not the rule

> *"'Do not rewrite history' is easy to agree with. **'Therefore every reader of
> that history must accept two vocabularies for ever'** is the operational
> consequence, it is invisible until something reads the old rows, and there may
> be other readers I have not found."*

`latestFieldEdit` would have silently lost every pre-rename context edit, and the
symptom — *"the document says it was last edited by nobody"* — looks nothing like
its cause. **It was found because a test happened to exercise that reader**, which
is worth being uneasy about rather than reassured by. §4.8 now says so in the
spec, so the next person meets the consequence with the rule.

### And the comment I asked for broke a guard

The no-backfill reasoning belongs inside `ACTIVITY_TYPES`, where the next person
meets it before the temptation — I asked for that and it is right.
`use-events.test.ts` was parsing that array **as text**, splitting on commas
without stripping comments, so the prose became entries. **The guard was reading
source rather than parsing it**, and a legal change exposed it. Fixed on the web
side, not here; nothing about this task's shape was wrong.
