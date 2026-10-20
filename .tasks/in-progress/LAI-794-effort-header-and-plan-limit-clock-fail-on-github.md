---
id: LAI-794
title: 'The Effort header is cut off on GitHub''s runner, and the plan-limit test reads the real clock'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-785
status: in-progress
started: 2026-10-20T00:01:26Z
---

## Goal

GitHub's gate (run 39343187125, `master` at `7e626d0f`) failed two browser
tests. Production is unaffected because the deploy was skipped, but on
`master` a red gate means nothing after it deploys (D-073).

1. `server/web/test/browser/task-size.test.ts` › *the List’s Effort column …*:

   ```
   the Effort header is cut off: label 803.734375 past cell 803
   ```

   The header passes on a Mac and is 0.73px too wide on GitHub's Linux runner.
   The column is 5.5rem.

2. `server/web/test/browser/usage.test.ts` › *the plan limit …*: it expected
   `/^At this rate you reach your limit around \d\d:\d\d\.$/` and got
   `At this rate you reach your limit around Tue 02:49.` The run was at 23:45
   UTC, so the forecast crossed midnight and the UI correctly added the
   weekday. The test reads the real clock, so it passes or fails depending on
   the hour it runs.

When this is done, the Effort header fits its column with room to spare on
any platform's fonts, and the plan-limit forecast is tested on a pinned clock,
with both the same-day and the next-day wording.

## Acceptance criteria

- [ ] The List's Effort column is wide enough that its header fits with
      margin whatever font the platform draws the resting sort glyph in. The
      fix is CSS: the column, the letter-spacing or the padding.
- [ ] The Effort-header test is not loosened. Any tolerance it keeps is at
      most 1px and is justified in a comment.
- [ ] The plan-limit test pins the browser's clock and zone, and asserts the
      same-day wording exactly (`around 15:00`).
- [ ] A new case pins the next-day wording exactly: `around Tue 02:49`.
- [ ] The rest of `usage.test.ts` and every other test LAI-773 added are
      checked for the same dependence on the time of day. Any found is fixed,
      and the census is recorded here.
- [ ] Each fixed file passes 5 runs in a row. Then `pnpm --filter @laika/web
      test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes / context

- Owner-direct, dispatched by the orchestrator. Commit locally and do not
  push. The board is not touched.
- `timeline-sprints.test.ts` › *the pill names the UTC day …* is the precedent
  for pinning the clock and the zone: `page.clock.setFixedTime` and CDP
  `Emulation.setTimezoneOverride`, run from `open()`'s `before` hook.
