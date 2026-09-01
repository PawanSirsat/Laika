---
id: LAI-049
title: Board UI — kanban and list views
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-011, LAI-007]
discovered-from:
status: done
finished: 2026-08-24T09:33:02+05:30
reviewed: 2026-08-24T11:25:00+05:30
started: 2026-08-24T09:21:28+05:30
---

## Goal

The screen the product is named for. Two views over one task list, per
SPEC §11.4.1 — real data through the LAI-007 API client, no fixtures.

## Acceptance criteria

- [x] **Kanban**: five columns — `backlog`, `todo`, `in_progress`, `review`,
      `done` — with counts. `cancelled` is behind a filter, not a column.
- [x] Cards show display key (`LAI-42`), title, assignee, priority, and the
      **blocked**, **ready** and **stale** markers of §11.4.1.
      *(blocked and ready shipped here; **stale** could not — `stale_flagged_at`
      was not on `TaskView`. Served by LAI-208, drawn by **LAI-157**, which
      ticked this line.)*
- [x] Dragging a card issues `POST /api/v1/tasks/:id/status`. An illegal
      transition **snaps back and surfaces the error** — it must not
      optimistically lie about a change the server refused.
- [x] **List view**: same tasks, sortable table, multi-filter on
      status/assignee/priority/ready/blocked.
- [x] One filter state, reflected in the URL, so a filtered board is linkable.
- [x] Live updates over SSE (LAI-048) rather than polling. If LAI-048 has not
      landed, **say so in your log and leave a single documented seam** — do not
      add polling that someone has to find and remove later.
- [x] Empty, loading, error and permission-denied states come from LAI-020.
      A `403` renders permission-denied, **never** an empty board.
- [ ] Agent-authored recent activity badged from `actor_kind` (§4.8).
      *(**not possible** — there is no activity endpoint at all. → LAI-209)*
- [x] No hardcoded data anywhere — CLAUDE.md §5.1. The mockup's names, counts and
      hostnames are fixtures.

## Notes / context

SPEC §11.4.1, §11.4.2.1, §4.5. Style from `docs/design/` — the prototype is the
target, not the source; do not lift its markup.

**`ready` is derived, never stored** (§4.5): `status IN ('backlog','todo')`, no
assignee, every dependency `done`. The API computes it; the UI displays it. If
you find yourself recomputing readiness client-side, that is the bug.

**Drag is the risky part.** The optimistic version is much nicer and is wrong the
moment the server disagrees — §5 validates transitions and a rejected drag must
visibly fail. Correctness first; smoothing it afterwards is a separate task.

No new dependencies. If drag-and-drop seems to need a library, file a task
naming it rather than adding one.

---

## Implementation notes for review (Builder-B)

`src/api/` — `tasks.ts`, `board-derive.ts` (pure), `use-board.ts`.
`src/routes/screens/` — `BoardScreen.tsx`, `board/{KanbanView,ListView,TaskCard}.tsx`.
`use-route.ts` gained query-string state.

### Two criteria are **not** met, and both need the API

I have marked them rather than ticked them.

- **`stale` marker (AC2).** `tasks.stale_flagged_at` is in the schema and the
  cron sets it, but `TaskView` does not carry it — so it never reaches the
  client. `blocked` and `ready` do ship. → **LAI-208**.
  *(Closed 2026-09-01: LAI-208 put it on `TaskView`, LAI-157 declared it on the
  client and drew the marker. AC2 above is now ticked. The reading of the
  situation was right — it was the field, not the card.)*
- **Agent-authored badge (AC8).** There is **no activity endpoint at all**;
  §6.4 lists `GET /projects/:slug/activity` and it is unimplemented. → **LAI-209**.

I deliberately did **not** badge from `created_via`. It records how a task was
created, not whether an agent has touched it recently — badging from it would
mark a task an agent created months ago and stay silent about one an agent is
working on now, which is the opposite of what §11.4.1 asks for. A plausible-looking
wrong badge is worse than an absent one.

### The bug that would have shipped an empty board

The page envelope is **`{ data, next_cursor }`**, not `items`. My client read
`items`, found `undefined`, and would have rendered "no tasks" on every project —
indistinguishable from an empty project. Caught by pointing it at a live server
with four real tasks, not in review. `tasks.ts` now carries a comment saying so,
because the failure is silent.

### Verified against a live board

Set up a fresh instance, created a project and four tasks, added a dependency,
moved two:

| Check | Result |
| --- | --- |
| Five columns, no `cancelled` column | Backlog 3 · To do 0 · In progress 1 · Review 0 · Done 0 |
| Card contents | `LC-1` p1 **ready**, `LC-2` p3 **blocked** + `1 dep`, keys/titles/priorities from the API |
| Ordering | p1 → p2 → p3, then by number |
| **Illegal drag** (`backlog → done`) | card **stayed in Backlog**, alert read *"Cannot move a task from backlog to done"* |
| Legal move (`backlog → todo`) | card moved, counts went 3→2 and 0→1 |
| Filters | `?ready=true` → 2 cards; `+priority=p1` → 1 card; both in the URL |
| View switch | `?ready=true&priority=p1&view=list` — same filter state, sortable table |
| Clear | filters dropped from the URL, 4 rows back |

### Moves are not optimistic, on purpose

The card is marked in-flight and **does not move** until the server answers. The
optimistic version is nicer and lies for the ~100ms before a rejection — and the
rejection is not rare here, because §5 validates every transition. The task said
correctness first; this is what that costs and it is worth it.

The error shown is the **server's own sentence**, not a generic one. *"Cannot move
a task from backlog to done"* tells someone what to do next; "that didn't work"
does not.

### `blocked` is derived, `ready` is not

`ready` comes from the server (§4.5) and is displayed untouched — recomputing it
here is the bug the task warns about.

`blocked` has no server field, so it is resolved against the tasks on screen:
the API returns dependency **ids** without statuses. When a dependency is outside
the loaded set the answer is **`undefined`, not `false`**, and the card shows
`deps ?`. Guessing "unblocked" would invite someone to start work that cannot
proceed — the more damaging error. That is the one case `board-derive.test.ts`
exists for.

### No SSE, and no polling either

LAI-048 has not landed. There is **one seam** — `reload()`, behind a visible
Refresh control — which a subscription will call. Deliberately not a timer: the
task asks for no polling that someone has to find and remove, and a button is
honest about the board being a snapshot.

### Keyboard

HTML drag-and-drop has no keyboard story, and the board is the product's main
screen. Every card carries a status `<select>` that performs the same move
through the same code path, so the board is fully operable without a mouse.

### No new dependencies

No drag-and-drop library. Native HTML5 drag plus `dataTransfer` was enough.

### Tests — 17 new, 135 in the package

`board-derive.test.ts` unit-tests the derivations, including the unresolvable
dependency and that `cancelled` is dropped rather than given a column.
`tasks.test.ts` covers the query-string mapping — including that `ready=false`
is **sent**, not truthiness-dropped — and that a refused transition rejects,
which is what the no-lie behaviour depends on.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass.
`@laika/web` **135/135**, `@laika/server` **477/477**.

## Review — PM, 2026-08-24

**Accepted.** Gate green: format, lint, typecheck, 506 server. Web tests pass —
**135 when all of them are actually run**, which is a finding of its own, below.

**No polling, and the seam is documented in both places it matters** —
`use-board.ts`: *"SSE (LAI-048) has not landed; `reload()` is the single seam"*,
and `BoardScreen.tsx`: *"deliberately not a timer"*. That was the instruction
most likely to be quietly ignored, because a `setInterval` works and nobody
notices it until someone has to remove it.

**Four tests that show the derivation was thought through:**

- **`ready=false is sent, not dropped`** — the falsy-filter bug. `?ready=false`
  and "no ready filter" are different queries and a truthiness check conflates
  them.
- **`an unresolvable dependency is undefined, not false`** — blocked is
  tri-state when a dependency is outside the loaded page. Returning `false`
  would be a confident wrong answer; `undefined` is an honest one.
- **`a known blocker wins over an unknown one`** — the resolution rule that makes
  the tri-state usable rather than merely correct.
- **`cancelled is dropped, not given a column`** — §11.4.1 says a filter, not a
  column, and it would have been easier to add a sixth column.

`escapes the slug`, `is stable — the same input gives the same order`, and
`rejects when the server refuses the transition` cover the snap-back criterion
and the ordering determinism.

### 23 web tests have never run — not your defect, but found here

`@laika/web`'s script is `node --test test/*.test.ts`, which matches six files.
There are nine: everything under `test/api/` has been skipped since LAI-106
created that directory. All 135 pass when run, so nothing is hidden — but the
gate would not have said so.

**I accepted LAI-106 and LAI-047 on a count that excluded them**, reading "112
passed" as coverage rather than as a number that had stopped moving. **LAI-054
filed at p1.**

`structure.test.ts` does not catch it by design — its comment says "the runner is
irrelevant to what it asserts". It validates where test files live, not whether
anything runs them. Two different properties; one was covered.
