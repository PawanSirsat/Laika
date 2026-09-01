---
id: LAI-208
title: Expose stale_flagged_at on TaskView so the board can draw the stale marker
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-049
status: review
started: 2026-09-01T13:50:00Z
finished: 2026-09-01T14:20:00Z
---

## Goal

SPEC §11.4.1 lists three card markers — **blocked**, **ready** and **stale** —
and LAI-049 AC2 requires all three. Two are drawable; **stale is not**.

`tasks.stale_flagged_at` exists in the schema (`server/src/db/schema.ts:235`) and
the nightly cron sets it (§11.7). It is **not** in `TaskView`, so it never
reaches the client and the board cannot render the marker.

## Acceptance criteria

- [x] `TaskView` carries the flag — `stale_flagged_at: number | null`, matching
      the column, rather than a precomputed boolean. The UI can decide how to
      present an age; it cannot invent a timestamp it was never sent.
- [x] `GET /projects/:slug/tasks` and `GET /tasks/:id` both include it.
- [x] A task the cron has flagged round-trips with a non-null value.
- [x] A follow-up `area: web` task is filed to draw the marker.

## Notes / context

Discovered building the board. **Not blocking** — the board ships with `ready`
and `blocked`, and LAI-049 records `stale` as unmet with this task as the reason.

`ready` is the precedent for how to think about this: it is **derived server-side
and displayed client-side** (§4.5), because two definitions of readiness would
drift. Staleness is different — it is *stored*, set by a job — so the honest
shape is to send the stored value and let the UI format it.

No new dependencies.

## Outcome

`TaskView` carries `stale_flagged_at: number | null`, and **the job now clears it
as well as setting it.**

### Submitted red, deliberately (§4.4, D-045)

**`server/web` fails one assertion and nothing else:**

```
server/web/test/api/view-type-drift.test.ts:154
not ok 2 - no server field is missing from its client type

  TaskView.stale_flagged_at is served and Task does not declare it —
  add it, or list it in clientOmits with a reason
```

That is LAI-213's drift check working. `clientOmits` lives in `server/web/`, so
there is **no exemption I could take that is not a crossing** — the case CLAUDE.md
§4.4 names explicitly. **LAI-157** is filed with this assertion quoted, and turns
it green.

Everything else is green: `@laika/server` **1710/1710**, `cli` 19/19, `pnpm lint`
EXIT=0, `pnpm format` EXIT=0.

### The timestamp, not a boolean (AC1)

`ready` is computed here because §4.5's rule must have one definition and a second
one on the client would drift. **Staleness is not computed anywhere** — a job
wrote it down. Sending `stale: true` throws away the only information the row
holds, and §11.4.1's marker wants to say *how* stale. There is a test that fails
if a `stale` or `is_stale` boolean ever appears beside it.

### What it means on a task that is no longer stale — decided, not deferred

Your question, and the field is not correct without an answer: **nothing un-wrote
it.** That did not matter while the column reached no client. It reaches one now,
so a set-only flag becomes **a permanent mark on a task that was briefly slow** —
picked up, finished, shipped, still labelled as one nobody is looking at.

**The job owns the field in both directions.** A flagged task failing any of the
three staleness conditions has the mark removed on the next run.

The alternative was clearing it in the routes on a status change. Rejected: the
rule for stale is three conditions — status, heartbeat, commit — and a handler
clearing on *"somebody touched it"* is a **second, simpler rule that can disagree
with the first**. That is §4.5's argument for `ready`, applied to a stored field.

**The cost, named rather than hidden:** a task rescued at noon keeps its marker
until the next nightly run. A signal built on a three-day window is already
coarse, and a marker one day stale is a much smaller wrong than two definitions
of staleness. LAI-157 is told not to paper over the lag client-side — if it is
judged too visible, the fix is the job's schedule, not a client guess.

A cleared task can be flagged again later with a **new** timestamp. "Since when"
means since *this* quiet spell, and there is a test for it.

### Verification

Nine tests. Mutations, each confirmed landed:

| mutation | result |
| --- | --- |
| `stale_flagged_at: null` in the built view (the original bug) | red — 3 tests |
| send a derived boolean instead of the timestamp | red — 4 tests |
| never clear the flag (the set-only behaviour) | red — 4 tests |
| clear it unconditionally (clear-then-reflag every night) | red — 4 tests |

The last one matters: a clear-then-reflag still reports a non-null value to every
"is it set" assertion while destroying the "since when" the field exists for.
`leaves it alone while the task is still stale` is the only thing that sees it.

### Two things the guards caught in my own work

**The existing field-list test in `test/services/tasks.test.ts` went red** — it
pins `TaskView`'s keys exactly so a new field is a deliberate act rather than a
diff nobody reads. It did precisely that here; I added the key.

**And my `changed` guard caught a broken setup.** The first version of the
round-trip test used a `PATCH` to set `in_progress`; the route ignores it — status
goes through `POST /tasks/:id/status`, one §5 step at a time — so the task stayed
in `backlog`, the job flagged nothing, and the assertions would have compared
`null` to `null` and passed. `expect(result.changed).toBe(1)` is what failed
instead. **The setup call now asserts its own status**, which is the rule that
should have stopped it a step earlier.
