---
id: LAI-1146
title: 'Board members popover from the avatar stack, and a Spaces popover that scrolls'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
status: review
started: 2026-11-05T19:10:00+05:30
finished: 2026-11-05T20:05:00+05:30
---

## Why

The owner, from screenshots of production (space RMB), 2026-11-05:

1. The board header's member stack (*A AK AP B +8*) does nothing when the
   *+8* is clicked; there is no way to see every member of the space.
2. The sidebar's **Spaces** popover runs off the bottom of the window when
   there are many spaces, and its list cannot be scrolled.

## Acceptance criteria

- [x] The board toolbar's `+N` is a button that opens a **Members** popover,
      styled like the Filter popover, listing every member of the space with
      avatar, name and role; it scrolls when long.
- [x] A search box at its top narrows the list by name or email,
      case-insensitively, with an empty-search state.
- [x] Escape and an outside click close it; focus returns to the `+N`;
      the rows are reachable by keyboard.
- [x] A row applies the existing assignee filter (`onAssignee`, the same
      `?assignee=` the faces and the Filter popover's Assignee field write),
      so the *Filtered by* chip appears. No new filter mechanism.
- [x] The Spaces popover fits the viewport: header and search stay put, only
      the list scrolls (`overflow-y: auto`, `overscroll-behavior: contain`),
      with consistent row heights and a subtle edge on the scroll area; the
      current space's row, if listed, is scrolled into view on open. Works in
      both themes and at 390px.
- [x] Browser tests: `+N` opens the list of every member; search narrows it;
      Escape closes it; a row applies the assignee filter; the Spaces list
      with ~30 spaces has `scrollHeight > clientHeight` and scrolls to its
      last row.

## Notes

`server/web/` only. Design tokens only, no new dependencies.

## Verification (Belka, load < 15 for each run)

From `server/web/`, each exit code captured on its own:

- `node --test --test-concurrency=1 test/browser/board-members-popover.test.ts`: exit 0, 5 tests (5 `test()` calls, two of them from one loop over themes).
- `pnpm run typecheck`: exit 0.
- `node --test --test-concurrency=1 test/theme/type-floor.test.ts`: exit 0, 7/7.
- `node --test --test-concurrency=1 test/api/endpoint-coverage.test.ts`: exit 0, 3/3.
- `node --test --test-concurrency=1 test/api/one-page-reads.test.ts`: exit 0, 6/6.
- `node --test --test-concurrency=1 --test-name-pattern="popover|More spaces|click outside" test/browser/spaces-sidebar.test.ts`: exit 0, 13/13.
- `node --test --test-concurrency=1 --test-name-pattern="sidebar open|row crowded|1024|920" test/browser/board-sprint-stats.test.ts`: exit 0, 13/13. This includes the `+2` assertion at line 701.

From `server/`: `pnpm exec vitest run --maxWorkers=1 test/tooling/structure.test.ts` exits 0 (20/20).

From the repo root, over the 7 touched files: `prettier --check` exits 0 and `eslint` exits 0.

The repo-root and whole-package suites were not run (Belka machine limits); CI runs them.
