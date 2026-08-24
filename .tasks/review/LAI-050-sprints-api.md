---
id: LAI-050
title: Sprints — table wiring, CRUD, and task assignment
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-011]
discovered-from:
status: review
started: 2026-08-24T09:56:11+05:30
finished: 2026-08-24T10:11:05+05:30
---

## Goal

Sprints as D-013 defined them: dates and a goal, no estimation. The `sprints`
table and `tasks.sprint_id` already exist (LAI-003); this is the API over them.

## Acceptance criteria

- [x] `GET`/`POST /api/v1/projects/:slug/sprints`, and
      `GET`/`PATCH`/`DELETE /api/v1/sprints/:id` — creation and mutation are
      `lead`+ (§3.2), reads follow project membership.
- [x] `POST /api/v1/sprints/:id/tasks` with `{ task_ids[] }` and
      `DELETE /api/v1/sprints/:id/tasks/:taskId`. Assignment is `member`+.
- [x] **At most one `active` sprint per project** — a second transition to
      `active` is `409 conflict`. Tested under concurrency, like LAI-011's claim.
- [x] **Sprints of one project may not overlap** in date range — rejected at
      write time with a message naming the sprint it collides with.
- [x] `ends_on` after `starts_on`, both required.
- [x] Deleting a sprint sets `sprint_id = NULL` on its tasks and **never deletes
      a task**. Completing one **never changes its tasks' statuses** — unfinished
      work stays unfinished and is moved deliberately.
- [x] `?sprint=` filter on the task list.
- [x] Services, not handlers (CONVENTIONS §2). Every mutation `assertCan`-checked
      and activity-writing.

## Notes / context

SPEC §4.15, §6.4, §3.2, D-013.

**Story points are a non-goal** (§1.1). A sprint carries dates and a goal. If a
criterion here seems to want velocity or estimates, it does not.

**The non-overlap rule is load-bearing, not fussiness.** D-014's timeline draws
one bar per sprint on a single track precisely because sprints cannot overlap —
allowing overlap turns a rendering pass into a layout solver. Reject it at write
time and the Phase 2.5 timeline stays cheap.

**The activity vocabulary has no sprint type** (§4.8) and it is closed. Same
handling as LAI-047: pick something defensible, say so in your log, and file a
task if you think the vocabulary should grow.

No new dependencies.

---

## Notes at review — builder-a

**615 tests** (55 new); format, lint, typecheck clean. Verified against the
**built** server:

```
create Jan 1-14           201
overlap 8-21              409  Those dates overlap sprint "Sprint 1"
starts on day 14          409  (ends_on is inclusive — see below)
backwards range           422  ends_on must be after starts_on
duplicate name            409
day after, 15-28          201
activate first / second   200 / 409  Sprint "Sprint 1" is already active
assign two                200  { tasks: [...] }
bulk with one unknown id  404  and the good one stayed out of the sprint
?sprint=<id> / =none      Task one+two / Loose
after completing          statuses backlog + todo — unswept
delete                    204; all three tasks survive, sprint_id null, status kept
activity                  project.updated/created ×2, /updated, task.updated/into ×2,
                          /updated, /deleted
```

**1. `ends_on` is inclusive, and §4.15 does not say.** It gives "date-only
semantics in the project's timezone" and stops. A sprint that *ends on* the 14th
includes the 14th — that is what a person filling in the field means — so the
range is `[starts_on, ends_on]`, a sprint starting on the 14th collides, and the
next one starts on the 15th. Stated at the top of `services/sprints.ts` and
asserted in seven overlap shapes including both touching cases.

One inherited consequence worth knowing: LAI-003's `ends_on > starts_on` CHECK is
strict, so **the shortest expressible sprint is two days.** A one-day sprint would
need `ends_on == starts_on`. Not worth a migration on its own; worth knowing
before someone reports it as a bug.

**2. One active sprint is enforced twice, and both layers are tested
separately.** A partial unique index — `ON sprints (project_id) WHERE status =
'active'` (migration 0006) — makes it true of the *data*; the service checks
first so the caller gets a 409 naming the sprint that holds it rather than a
constraint violation as a 500. A test bypasses the service entirely and asserts
the index bites. Making the index non-unique fails exactly that one test and
nothing else, which is how I know the two layers are independently load-bearing.

Migration 0006 is a `CREATE UNIQUE INDEX` — no table rebuild — so the `activity`
triggers are untouched and no rescue block was needed. LAI-044's test confirms.

**3. Non-overlap cannot be a constraint, so it is a read inside the write lock.**
It compares a row against every other row, which SQLite cannot express as a
CHECK. Both it and the active check run inside the same `BEGIN IMMEDIATE` as the
insert. Proved with worker threads on separate connections: six racing to activate
→ exactly one wins; four racing for the same fortnight → exactly one wins.
Swapping `BEGIN IMMEDIATE` for a deferred transaction fails those tests.

**4. Bulk assignment is all-or-nothing.** One unknown id, or one from another
project, rejects the whole request inside the transaction. A half-applied bulk
leaves the caller unable to tell which half without re-reading every task, and the
retry is neither safe nor idempotent.

**5. `POST /sprints/:id/tasks` answers `{ tasks: [...] }`, not `{ data,
next_cursor }`.** It is an action's result, not a list endpoint, and a `data` key
with no cursor beside it invites a client to page through something that does not
paginate. `DELETE .../tasks/:taskId` returns the task, following
`DELETE /tasks/:id/dependencies/:depId`.

**6. Sprint status is a field, not a validated transition.** §4.15 states one rule
about it — at most one active — and inventing a transition table it does not
describe would be making up product. So reopening a completed sprint is allowed.
Flag if you disagree; it is two lines either way.

**7. The activity verb is a wart again. Filed as LAI-113.** The sprint itself is
recorded as `project.updated` with `{ entity: 'sprint', action }`, so deleting a
sprint reads as a project settings edit. Tasks moving in and out are `task.updated`
with `{ field: 'sprint_id', from, to }`, which needs no apology. **Sixth time**
a task has needed a verb §4.8 lacks; LAI-113 argues the useful check is not
"`enums.ts` vs §4.8" (those already agree) but "does every mutating service
function have a verb for what it did". It also asks to be bundled with LAI-110,
since both rebuild `activity` and the trigger-rescue block would otherwise be
hand-written twice.

**8. `sprint_id` is now on `TaskView`.** `?sprint=` without it would let a client
filter on something it cannot see. `?sprint=none` finds unassigned work, matching
`assignee=none` and for the same reason.

**9. My first verification script was wrong and I nearly believed it.** It
reported 422 where the server returns 409. The server was right; the harness was
mangling bodies. Second time this has happened (LAI-037 was the first), and both
times the tell was the same — a result that disagreed with a passing test.
