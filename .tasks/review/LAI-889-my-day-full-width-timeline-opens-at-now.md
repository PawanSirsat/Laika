---
id: LAI-889
title: "My day: the Timeline across the page, Agent time below it, the day opens at now, and no page stops short of a wide screen"
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: review
started: 2026-10-22T11:39:35Z
finished: 2026-10-22T11:42:24Z
---

## Goal

Three things the owner asked for on seeing LAI-888 live (2026-10-22): the
Timeline card spans the whole page, above the editor and the two lists, with
*Agent time* and *On your plate* beside the editor below it — as the v3
design lays it out; on today the Timeline opens scrolled to now, not to the
first block; and on a wide screen a page uses the width it has — My day
stopped at 84rem, and other screens stop the same way.

## Acceptance criteria

- [x] On My day the Timeline card is the full width of the page, above the
      grid that holds the editor, *To settle*, *Confirmed* and the side column.
- [x] On today, at 1× and 2×, the Timeline opens with now in view, now at
      about three fifths of the way across; on another day it opens on the
      first block as before. Fit is unchanged.
- [x] My day has no fixed maximum width; nor does any other screen whose
      wrapper capped itself in rem (Developer access, Organisation, Members).
      Screens that are a narrow form or a notice by design keep their width.
- [x] Every My day browser and unit test is green; the ones that measured the
      Timeline inside the main column are re-aimed.
- [x] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Built by CHIEF on the owner's direct instruction, in the temporary
  worktree `Laika-myday-width` on `LAI-889-my-day-full-width`.
- Files: `server/web/src/routes/screens/my-day/` and the three screens'
  stylesheets named above; their tests. No new dependencies.

## Record

- Connect keeps its 68rem column: it is a wizard laid out as a centred column
  on purpose (LAI-733, LAI-740), and `connect.test.ts` asserts the column is
  narrower than the content area. Developer access, Organisation, Members and
  My day lost their caps.
- The My day browser files: 75 tests green on the branch. The repo-root gate
  was run once, on master after the merge.

