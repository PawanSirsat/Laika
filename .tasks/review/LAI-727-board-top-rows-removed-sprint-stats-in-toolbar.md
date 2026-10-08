---
id: LAI-727
title: 'UI polish — remove the sprint strip and WORKING NOW rows from the Board; DONE / BLK / LEFT move into the toolbar'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-10-08T12:48:30Z
finished: 2026-10-08T13:41:25Z
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
- `server/web/src/components/space/SpaceSlot.tsx` — comments only
- Tests: `server/web/test/browser/board-sprint-stats.test.ts` (new),
  `sprint-strip.test.ts`, `board-sprint-default.test.ts`,
  `board-refresh.test.ts`, `board-presence.test.ts`, `list-view.test.ts`,
  `space-bar.test.ts`, `filter-popover.test.ts`, `board-lane-scroll.test.ts`,
  `space-chrome-compaction.test.ts` (a comment),
  `server/web/test/routes/screens/board-bands.test.ts`,
  `server/web/test/routes/screens/board/sprint-stats.test.ts` (new)
- `server/test/tooling/structure.test.ts` — one `WEB_NO_MIRROR_REQUIRED`
  entry, for the hook `use-sprint-stats.ts` (the `WEB_*` maps, D-026)

No spacing CSS changed: with both rows gone the Board's toolbar row sits
exactly where the List's already did (measured, y=98 at 1366×768 on both).

`SprintStrip.tsx` and `sprint-strip.css` **stay**: the Timeline renders the
same strip (`timeline/TimelineScreen.tsx`), and `timeline/` is not touched.

## Acceptance criteria

- [x] The Board and the List render no sprint strip (`.strip`) and no WORKING
      NOW row (`.presence`, the heading text), with presence on and people
      present.
- [x] The toolbar row carries a stat group, right-aligned before the icon
      buttons, reading `<scope> DONE d/t | BLK b | LEFT n`, BLK in the danger
      token, with the same numbers the strip's summary showed for the same
      selection: an active sprint, All sprints, and a sprint with blocked
      tasks.
- [x] No whole-project task walk is made for the figures: on a sprint-scoped
      board every task request carries `sprint=`.
- [x] Sprint selection works without the strip: the board still opens on the
      active sprint (LAI-713); the Filter popover's Sprint field switches it and
      the figures follow; Sprint = Any and the chip's × both give
      `sprint=all`.
- [x] The group has an accessible name and each figure reads as a sentence
      ("Done 7 of 30").
- [x] At 1366×768 and at 900px wide the group does not overlap the search, the
      Filter button or popover, the chips row or the icon buttons, and the page
      does not scroll sideways; both themes.
- [x] The header's `Agents N` still counts from presence. (No presence read
      existed for the row alone: `SpaceLive`'s read also feeds `Agents N`, so
      it stays; Activity and Capacity read their own.)
- [x] Existing tests that asserted the strip or the row are moved onto the
      stat group or retired with a stated reason; every new test fails on the
      old code (swap, trap, checksum).
- [x] Screenshots, light and dark: Board before and after, List after, 900px
      after.
- [x] Repo gate `pnpm test`, `pnpm lint`, `pnpm format` exits 0/0/0 after the
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

## How the figures are computed — the (a)/(b) choice

The strip's definitions, unchanged: DONE = `status === 'done'` over every task
in scope, subtasks included, out of all of them; BLK = `!ready && status !==
'done'`; LEFT = days left in the selected sprint, inclusive, `—` for All
sprints. Counted in `board/sprint-stats.ts` from a set chosen by
`board/use-sprint-stats.ts`:

- **No server-side filter** (the default — LAI-713 opens on the active
  sprint): the board's own task set. The server returns exactly what the
  strip filtered its walk down to, so the figures are the strip's with **no
  request at all**.
- **A sprint plus a server-side filter** (assignee, status, priority, tag,
  ready, updated): **(a)**, one `?sprint=<id>` read — one page of ≤200 for any
  sprint so far, re-read after each board read — so the figures stay the
  whole sprint's, as the strip's were, instead of silently becoming the
  filtered subset's.
- **All sprints plus a server-side filter**: **(b)**. The unfiltered answer
  there *is* the whole-project walk this task removes, so the figures are the
  board's filtered set and the group says so: `All sprints · filtered`, in
  its accessible name and tooltip too.

Search, Blocked, Top-level, Overdue and the agent toggle are applied in the
browser after the read; they never narrowed the strip and do not narrow these.

One deliberate difference: `?sprint=none` showed `0/0` in the strip, which
filtered on `sprint_id === 'none'` and so matched nothing. The board's read
counts the tasks in no sprint.

## Where the rows rendered

Both were already Board-only: the strip behind `view !== 'list'`, WORKING NOW
behind `path === '/board'` in `SpaceLayout`. No other tab showed either. The
presence read in `SpaceLive` stays because `Agents N` reads it; Activity and
Capacity fetch their own. This retires audit finding L20 ("Working now labels
other projects' tasks").
