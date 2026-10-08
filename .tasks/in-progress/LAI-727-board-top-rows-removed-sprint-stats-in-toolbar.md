---
id: LAI-727
title: 'UI polish — remove the sprint strip and WORKING NOW rows from the Board; DONE / BLK / LEFT move into the toolbar'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-08T12:48:30Z
---

## Goal

Made on the owner's direct instruction; UI polish. The builder is a single
agent working the way `docs/HANDOVER.md` §4 describes, on branch
`build-ui-board-top` cut from `master` 5adbfae; nothing here is pushed.

The owner, with two cropped screenshots of production's Board (OnRoute):
*"remove this row completely from the board, but I want that DONE, BLK and
LEFT — add that somewhere on top, adjust that one; then also remove this row,
that's it."*

Row 1 is the sprint strip (`All sprints`, one chip per sprint, the `›` pager
and the `DONE 7/30 · BLK 23 · LEFT 24` box). Row 2 is the WORKING NOW presence
row. When this is finished neither row is on the Board or the List, the three
figures sit in the toolbar row as a compact group prefixed by the scope they
describe, and switching sprints is done through the Filter popover's Sprint
field and its chip.

## Scope — the exact files (CLAUDE.md §1)

- `server/web/src/routes/screens/BoardScreen.tsx` — strip render, its
  whole-project task walk and its state removed; the stat group added
- `server/web/src/routes/screens/board/BoardToolbar.tsx` — **one line**: the
  slot the stat group renders into
- `server/web/src/routes/screens/board/SprintStats.tsx` (new)
- `server/web/src/routes/screens/board/sprint-stats.css` (new)
- `server/web/src/routes/screens/board/sprint-stats.ts` (new) — the counts
- `server/web/src/routes/screens/board/use-sprint-stats.ts` (new) — which
  task set the counts are taken from
- `server/web/src/components/space/SpaceLayout.tsx` — WORKING NOW removed
- `server/web/src/components/space/PresenceStrip.tsx`,
  `presence-strip.css` — deleted (nothing else renders them)
- `server/web/src/components/space/SpaceSlot.tsx`, `space.css`,
  `board-toolbar.css` / `board.css` — comments and spacing only, if the
  measured layout needs it
- Tests: `server/web/test/browser/board-sprint-stats.test.ts` (new),
  `sprint-strip.test.ts`, `board-sprint-default.test.ts`,
  `board-refresh.test.ts`, `board-presence.test.ts`, `list-view.test.ts`,
  `space-bar.test.ts`, `filter-popover.test.ts`, `board-lane-scroll.test.ts`,
  `server/web/test/routes/screens/board-bands.test.ts`,
  `server/web/test/routes/screens/board/sprint-stats.test.ts` (new)

`SprintStrip.tsx` and `sprint-strip.css` **stay**: the Timeline renders the
same strip (`timeline/TimelineScreen.tsx`), and `timeline/` is not touched.

## Acceptance criteria

- [ ] The Board and the List render no sprint strip (`.strip`) and no WORKING
      NOW row (`.presence`, the heading text), with presence on and people
      present.
- [ ] The toolbar row carries a stat group, right-aligned before the icon
      buttons, reading `<scope> DONE d/t | BLK b | LEFT n`, BLK in the danger
      token, with the same numbers the strip's summary showed for the same
      selection: an active sprint, All sprints, and a sprint with blocked
      tasks.
- [ ] No whole-project task walk is made for the figures: on a sprint-scoped
      board every task request carries `sprint=`.
- [ ] Sprint selection works without the strip: the board still opens on the
      active sprint (LAI-713); the Filter popover's Sprint field switches it and
      the figures follow; Sprint = Any and the chip's × both give
      `sprint=all`.
- [ ] The group has an accessible name and each figure reads as a sentence
      ("Done 7 of 30").
- [ ] At 1366×768 and at 900px wide the group does not overlap the search, the
      Filter button or popover, the chips row or the icon buttons, and the page
      does not scroll sideways; both themes.
- [ ] The header's `Agents N` still counts from presence; the presence read
      that fed only the row is gone with it.
- [ ] Existing tests that asserted the strip or the row are moved onto the
      stat group or retired with a stated reason; every new test fails on the
      old code (swap, trap, checksum).
- [ ] Screenshots, light and dark: Board before and after, List after, 900px
      after.
- [ ] Repo gate `pnpm test`, `pnpm lint`, `pnpm format` exits 0/0/0 after the
      last edit.

## Notes / context

- The strip's logic (`SprintStrip.tsx`, `countFor`) to reproduce: DONE is
  `status === 'done'` over **every** task in scope, subtasks included, out of
  all of them; BLK is `!ready && status !== 'done'`; LEFT is **days** left in
  the selected sprint (`daysLeft`, inclusive, never negative), and `—` for All
  sprints. All sprints counts every task in the project, sprint or not.
- No new dependency. Design tokens only.
- Conflicts to avoid: `build-perf-store` is moving BoardScreen's data loading
  into a store — BoardScreen edits stay confined to the strip, the presence
  wiring and the stat group. `build-ui-dropdown` is editing `BoardToolbar.tsx`
  and `board-toolbar.css` — one line in the former.
