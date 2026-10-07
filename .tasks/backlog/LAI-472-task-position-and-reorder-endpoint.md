---
id: LAI-472
title: 'Tasks get a stored `position`, and an endpoint that moves one card'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

**The owner wants to drag a card to a new place in its lane and have it stay
there.** There is nowhere to put that fact. `tasks` has no ordering column, and
lane order comes from `services/tasks.ts:447` —
`orderBy(asc(tasks.updatedAt), asc(tasks.id))`.

**An order keyed on `updated_at` rearranges itself.** Retitle a card and it
slides to the bottom of its lane. Drop one into another lane and it lands at the
end rather than where it was dropped. This is the LAI-260 defect on the board
instead of the sidebar, and the owner's words there apply unchanged: *"seque must
not be change"*.

This task is the server half: a stored `position`, an endpoint that moves one
card relative to its neighbours, and a lane order that reads from it. **The drag
itself is LAI-473** and is blocked on this.

**Read D-060 before starting.** It settles the shape and says which parts are
yours to choose.

## Acceptance criteria

- [ ] **`tasks` gains a `position` column**, ordering every task in a project as
      one sequence. Not per-lane — a lane is a filtered view of that sequence
      (D-060.2).
- [ ] **`POST /api/v1/tasks/:id/reorder`** moves one card, addressed by its
      **neighbours** rather than by an index: body
      `{ before_task_id?, after_task_id? }`, at least one present.
      `after_task_id` is the card it lands **directly below**; `before_task_id`
      the card it lands **directly above**. *(Amended by CHIEF before claim,
      2026-10-07, D-070:)* "genuinely adjacent" cannot hold — a lane is a
      filtered view of one project sequence, so two cards side by side in a
      lane are rarely neighbours in it. The rule is: with both present,
      `after` must sort before `before`, or the board changed under the drag
      and the answer is `409`; the card is placed **immediately after
      `after_task_id`** in the project sequence (or immediately before
      `before_task_id` when only that is sent). That lands it between the two
      cards in every lane, and makes two concurrent drops into one gap land
      side by side rather than computing the same key. A drop where the card
      already is writes nothing.
- [ ] **It calls `can(actor, 'task.write', task)`** before it reads or writes
      anything (CLAUDE.md §5). The action already exists — **do not add a §3.1
      row.** A viewer is refused.
- [ ] **A neighbour in a different project is refused `422`**, not silently
      accepted. Cross-project reordering is not a thing.
- [ ] **A move writes exactly one row's `position`.** Assert it against a third,
      untouched task: its `position` and its `updated_at` are both unchanged. A
      renumbering strategy that rewrites the lane is a rebalance, and a rebalance
      that runs on an ordinary drop fails this.
- [ ] **Repeated drops into the same gap keep working.** Drive the same
      `before`/`after` pair **60 times** and assert the order is still correct
      and distinct at the end. D-060 names the trap: fractional midpoints run out
      of `REAL` precision after roughly fifty. Whichever representation you pick,
      this is the test that proves it survives.
- [ ] **Two concurrent reorders do not silently swap or collide.** Two writers
      targeting the same gap: both orders are valid afterwards, no two rows in
      the project share a `position`, and nothing is lost.
- [ ] *(Amended by CHIEF before claim, 2026-10-07, D-070.)* **Every
      `TaskView` serves `position`, and `GET /projects/:slug/tasks` keeps its
      `(updated_at, id)` order.** That order is the paging key agents catch up
      on (`updated_since`, LAI-704); re-keying it on `position` would let a
      reorder between two page reads skip a task. The board already loads every
      task and builds its lanes in the browser, so it sorts by `position`
      itself (LAI-473). D-060.5's concern — a lane ordered by `updated_at` —
      is answered there, not here.
- [ ] **A new task is placed at the end of its project's sequence**, so it
      lands at the bottom of its lane — Jira's default for a new issue.
- [ ] **Existing tasks get a `position`**, in their current visible order —
      the board's, which is priority then number since LAI-606 — so no board
      reshuffles on upgrade. Assert the before/after order of a seeded project
      is identical. *(Amended, D-070:)* filled by a boot-time backfill beside
      `backfillTaskTimestamps` rather than in SQL, because the keys are
      computed; idempotent, it only fills a null.
- [ ] **A reorder writes `task.updated` with `{ field: 'position', from, to }`**
      and emits the SSE frame. **No new `ACTIVITY_TYPES` value** — D-060.4 gives
      the reasoning, and adding one turns this into a three-owner change.
- [ ] Full gate — repo root, all three `EXIT 0`, each captured on its own line
      (CLAUDE.md §5).

## Notes / context

**This is a two-owner change (CLAUDE.md §4.4).** `schema-spec-drift.test.ts`
reads every §4 table as `field | notes` and compares it against `schema.ts`, so
**the SPEC row and the column must land together or the guard goes red.**

**The `docs/` half is CHIEF's and is not yours to write.** CHIEF applies it at
merge time (§4.4 step 5). It is two lines, quoted here so you know exactly what
your column must match:

In §4.5, a row:

```
| `position` | manual board order within the project, one sequence per project (D-060) |
```

In §6.4, beside the other task routes:

```
POST   /api/v1/tasks/:id/reorder             body { before_task_id?, after_task_id? }
```

**Submit red if you must, and name the failure.** If `schema-spec-drift` is the
only red and it is red because CHIEF's two lines are not in yet, quote the exact
failing assertion in this file and say so. §4.4 step 1 covers this; `origin/master`
never sees it.

**The representation is yours** (D-060). Sparse integers with a rebalance,
fractional midpoints, or a lexical rank — the criteria above are behavioural on
purpose. Pick one, write down why in the task file, and let the 60-drop test
decide whether it holds.

**No new dependencies.** If you think a rank library is warranted, that is a task
for CHIEF, not an install.

**Do not touch `server/web/`.** The drag, the drop indicator and the feed
suppression are SHELL's, in LAI-473.
