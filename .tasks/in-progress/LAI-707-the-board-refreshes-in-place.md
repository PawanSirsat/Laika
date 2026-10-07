---
id: LAI-707
title: 'The board refreshes in place — no flash on a live change'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-702
status: in-progress
started: 2026-10-07T07:25:56Z
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

- [ ] `api/board-merge.ts` (+ unit test): `mergeTasks(prev, incoming, keep)`
      keeps the old object for every unchanged task (deep comparison, key
      order ignored, never by `updated_at`), returns the `prev` array itself
      when nothing changed, and reports `changed` and `removed`. The test
      mutates every key of a full Task in turn and proves each is detected.
- [ ] `use-board.ts` has one state writer, `commit(next, meta)`, and a source
      scan asserts exactly one `setState(` in the file and that `move()`
      writes through it. `status: 'loading'` happens only on first load or a
      new slug/filter; a same-query refresh sets `refreshing` and keeps
      `tasks`. The fetch effect's dependency list is unchanged.
- [ ] A task with a local write in flight, or written after a refresh began,
      is not overwritten by that refresh (no snap-back).
- [ ] A refresh that fails keeps the board and shows a `role="status"` notice
      — *"Could not refresh — this is the board as of HH:MM"* — with Retry;
      `unauthorized`, `forbidden` and `not_found` still replace the board.
- [ ] Refresh answers are held while a pointer drag is in progress and
      applied on the drop.
- [ ] The skeleton only shows on first load or a query change, and once shown
      it stays for `useDelayed`'s hold (the board's branch checked status
      first, so the hold never applied).
- [ ] The sprint strip's task list re-reads on the same ticks, in place.
- [ ] Browser tests, each red against today's code: Refresh with a slow answer
      keeps the same `.kanban` node and shows no skeleton; unchanged cards keep
      their DOM nodes; lane scroll and a composer draft survive; a 500 keeps
      the board with the notice, Retry clears it; a stream frame (fake
      `EventSource`) redraws in place; the strip follows a live frame; a
      refresh during a drag waits for the drop. Guards: a 403 replaces the
      board; a filter change still shows the skeleton.
- [ ] Existing source scans and browser tests stay green; the gate exits 0.

## Notes / context

Plan agreed with the owner 2026-10-07. Coordinated with `laika-7c`: its
LAI-473 adds `place()` to `use-board.ts` with three writes; whichever lands
second converts them to `commit(next, { origin: 'local', settled })`. The card
animation is LAI-708. Harness: an optional `before(page)` hook on `open()` and
a fake `EventSource` the test can fire frames through.
