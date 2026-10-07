---
id: LAI-707
title: 'The board refreshes in place — no flash on a live change'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-702
status: done
started: 2026-10-07T07:25:56Z
finished: 2026-10-07T07:40:19Z
---

## Goal

The owner, 2026-10-07: *"when anything changes from the board or anywhere by
using MCP, the screen flickers and flashes — I want that transition very
smooth."* Every stream frame triggers `board.reload()` 300 ms later
(`BoardScreen.tsx`'s tick effect; also a gap, Refresh, and every drawer edit,
each then echoed by the stream). `reload()` re-runs `use-board.ts`'s fetch
effect, which sets `status: 'loading'`, and BoardScreen renders `null` or a
skeleton **instead of** `.board-main` — the whole board unmounts and rebuilds,
losing lane scroll, composer drafts and drags. A person's own move flashes
about 300 ms after it lands, when its echo arrives.

A refresh of the **same** query must leave the board on screen and change only
what changed.

## Acceptance criteria

- [x] `api/board-merge.ts` (+ unit test): `mergeTasks(prev, incoming, keep)`
      keeps the old object for every unchanged task (deep comparison, key
      order ignored, never by `updated_at`), returns the `prev` array itself
      when nothing changed, and reports `changed` and `removed`. The test
      mutates every key of a full Task in turn and proves each is detected.
- [x] `use-board.ts` has one state writer, `commit(next, meta)`, and a source
      scan asserts exactly one `setState(` in the file and that `move()`
      writes through it. `status: 'loading'` happens only on first load or a
      new slug/filter; a same-query refresh sets `refreshing` and keeps
      `tasks`. The fetch effect's dependency list is unchanged.
- [x] A task with a local write in flight, or written after a refresh began,
      is not overwritten by that refresh (no snap-back).
- [x] A refresh that fails keeps the board and shows a `role="status"` notice
      — *"Could not refresh — this is the board as of HH:MM"* — with Retry;
      `unauthorized`, `forbidden` and `not_found` still replace the board.
- [x] Refresh answers are held while a pointer drag is in progress and
      applied on the drop.
- [x] The skeleton only shows on first load or a query change, and once shown
      it stays for `useDelayed`'s hold (the board's branch checked status
      first, so the hold never applied).
- [x] The sprint strip's task list re-reads on the same ticks, in place.
- [x] Browser tests, each red against today's code: Refresh with a slow answer
      keeps the same `.kanban` node and shows no skeleton; unchanged cards keep
      their DOM nodes; lane scroll and a composer draft survive; a 500 keeps
      the board with the notice, Retry clears it; a stream frame (fake
      `EventSource`) redraws in place; the strip follows a live frame; a
      refresh during a drag waits for the drop. Guards: a 403 replaces the
      board; a filter change still shows the skeleton.
- [x] Existing source scans and browser tests stay green; the gate exits 0.

## Notes / context

Plan agreed with the owner 2026-10-07. Coordinated with `laika-7c`: its
LAI-473 adds `place()` to `use-board.ts` with three writes; whichever lands
second converts them to `commit(next, { origin: 'local', settled })`. The card
animation is LAI-708. Harness: an optional `before(page)` hook on `open()` and
a fake `EventSource` the test can fire frames through.

## Built — CHIEF, 2026-10-07

**What changed.** `api/board-merge.ts` (deep compare, old objects kept, the
old array when nothing changed); `use-board.ts` with one writer `commit()`,
`settledKey` for "same question", `pending` and `lastLocalWrite` so a refresh
never undoes a local write, `hold()`, `refreshing` / `refreshError` / `asOf`,
and access errors still replacing the board; `BoardScreen.tsx` with
`firstLoad || showBoardSkeleton` (the hold now applies), one `refresh()` for
the board and the strip (whose list now re-reads in place), window drag
listeners holding answers, the stale notice, `aria-busy`. Harness: `before`
hook and `fakeStream()`.

**Measured.** `board-refresh.test` 11/11. Against the pre-fix `use-board.ts`
and `BoardScreen.tsx` (swap verified: no `commit(`, no `refresh()`), the eight
behaviour tests fail and the two guards pass. The race test (an answer read
before your move, delivered after it) fails when the write-after-read rule is
removed and passes with it. Unit: merge 7/7 including every Task key mutated;
the single-writer scan. Web 1245/1245; lint, format, `tsc` exit 0.

**Seen on a real server** (port 3193, the real event stream): a task moved and
renamed over the API reached the board live — the card changed lanes and
title, the `.kanban` element stayed the same node, no skeleton appeared, and an
untouched card kept its node.

**For laika-7c's LAI-473:** `place()`'s writes go through `commit(next, {
origin: 'local', settled })`; a source scan now fails on a second `setState(`.

## Review — CHIEF, 2026-10-07

Accepted. Against the diff: `use-board.ts` has one `setState(` and the scan
says so; the fetch effect's deps are unchanged; a same-question refresh keeps
`status: 'ready'`; access errors replace the board, others keep it with the
notice; the race rule is shown load-bearing by its mutation; BoardScreen's
branch is `firstLoad || showBoardSkeleton`; every `board.reload` caller goes
through `refresh()`, which re-reads the strip. Real-server check recorded.
Gate on `master`, then push — **no deployment** (owner's instruction).
