---
id: LAI-794
title: 'The Effort header is cut off on GitHub''s runner, and the plan-limit test reads the real clock'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-785
status: done
started: 2026-10-20T00:01:26Z
finished: 2026-10-20T03:40:52Z
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

- [x] The List's Effort column is wide enough that its header fits with
      margin whatever font the platform draws the resting sort glyph in. The
      fix is CSS: the column, the letter-spacing or the padding.
- [x] The Effort-header test is not loosened. Any tolerance it keeps is at
      most 1px and is justified in a comment.
- [x] The plan-limit test pins the browser's clock and zone, and asserts the
      same-day wording exactly (`around 15:00`).
- [x] A new case pins the next-day wording exactly: `around Tue 02:49`.
- [x] The rest of `usage.test.ts` and every other test LAI-773 added are
      checked for the same dependence on the time of day. Any found is fixed,
      and the census is recorded here.
- [x] Each fixed file passes 5 runs in a row. Then `pnpm --filter @laika/web
      test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes / context

- Owner-direct, dispatched by the orchestrator. Commit locally and do not
  push. The board is not touched.
- `timeline-sprints.test.ts` › *the pill names the UTC day …* is the precedent
  for pinning the clock and the zone: `page.clock.setFixedTime` and CDP
  `Emulation.setTimezoneOverride`, run from `open()`'s `before` hook.

## What changed (LAI-794)

- `server/web/src/routes/screens/list/list.css:131`: `.list-col-size` is now
  6rem (it was 5.5rem). The comment above it gives the reason.
- `server/web/test/browser/task-size.test.ts:404`: a second check that the
  header also fits with the resting glyph drawn 1em wide. The check above it
  is unchanged.
- `server/web/test/browser/usage.test.ts:628`: `MIDDAY` and `LATE` (Monday 19
  October 2026, UTC), `pinClock()` and `browserClock()`. The plan-limit test
  pins `MIDDAY` and asserts `around 15:00.` exactly (`:931`). A new case
  pins `LATE` and asserts `around Tue 02:49.` exactly (`:944`).

## Why the header was cut off

The resting sort glyph `↕` (U+2195) is outside the unicode ranges of
`@fontsource-variable/plus-jakarta-sans` and `jetbrains-mono`. Their latin
subset has U+2191 and U+2193 but not U+2195. So each platform draws the glyph
in its own fallback font. Measured in the List at 1366px on a Mac: cell 88px,
button 77.2px, word `EFFORT` 50.27px, gap 5px, so the glyph is 7.94px and
the label ends 3.8px inside the cell. GitHub's label ended 4.53px further
right against the same cell edge, so its glyph was about 12.47px, which is
1em at the glyph's 12.5px.

At 6rem the glyph has room up to 96 − 7 − 14 − 5 − 50.27 = 19.73px, about
1.58em. That leaves 11.8px spare on a Mac, and about 7.3px with GitHub's
glyph (computed from the measurements above). The width comes out of
SUMMARY, not the table's minimum.

## Proof

| check | result |
| --- | --- |
| new 1em check, old CSS (5.5rem), this Mac | **red**: `label 803.765625 past cell 803 with the glyph 12.5px wide` (GitHub: `803.734375`); the check above it stays green |
| new 1em check, 6rem | green |
| old plan-limit test, `TZ=America/New_York` at 23:31 local (03:31Z), real clock | **red**: `actual: 'At this rate you reach your limit around Tue 02:31.'`, the CI failure reproduced without mocking |
| new plan-limit tests, same moment, same zone | both green |
| mutation: `clockLabel` never adds the day | only the next-day case red: `around 02:49.` |
| mutation: `clockLabel` always adds the day | only the same-day case red: `around Mon 15:00.` |
| mutation restored | checksum `605fa514…` matches; `git status` on `src/api/` clean |
| new plan-limit tests under `TZ=Pacific/Kiritimati` (UTC+14) and `Pacific/Pago_Pago` (UTC−11) | exit 0 each, 2 of 2 |
| `task-size.test.ts`, 5 runs | exit 0 ×5, 12 test cases each |
| `usage.test.ts`, 5 runs | exit 0 ×5, 14 test cases each |
| `pnpm --filter @laika/web test` | exit 0: 2183 test cases, 686 suites, 0 failed |
| `pnpm lint` | exit 0 |
| `pnpm format` | exit 0 |
| root `pnpm test` | **exit 1** on one server test, unrelated (below) |

The root `pnpm test` exited 1 on `server/test/db/migrate.test.ts:323`,
*"migrates a populated pre-rebuild database with nothing dangling"*. It timed
out at 5000ms (6348ms) with all three workspaces running. Run alone, the file
exits 0 with 24 of 24, and that test takes 95ms. This is already filed as
LAI-768. The same run's `cli` (431 test cases, 0 failed) and `server/web`
(2183, 0 failed) both finished. This change touches no server code.

## Census (LAI-794): every test LAI-773 added, read for time-of-day dependence

The set is the 39 test files in `git diff 7a95633c 758f867d` (LAI-773's
merge). Each was grepped for a real clock (`Date.now`, `new Date()`, `today`)
and a calendar or clock read (`toDateString`, `toLocale*`, `get*Day`,
`getHours`, `\d\d:\d\d`, weekday, midnight). Every hit was then followed to
its assertion. Only the plan-limit test depended on the time of day.

| file:line | clock | why it is safe |
| --- | --- | --- |
| `server/web/test/browser/usage.test.ts:31` `today`, `dayOf()` | real, UTC days | fixtures say `tz: 'UTC'`; no assertion reads a date or a day name, only counts and figures |
| `server/web/test/browser/usage.test.ts:618` `NOW_MS` (alerts) | real | `created_at` is never shown as a time; the banner's asserted text has no clock |
| `server/web/test/browser/task-tokens.test.ts:372` `handed in 13 Oct` | fixed `finished_on: '2026-10-13'` | `roundLabel` formats in `timeZone: 'UTC'` |
| `server/web/test/browser/task-tokens.test.ts:746` runaway `7\d min` | real `NOW − 75 min` | a duration, not a time of day; `7\d` absorbs the run's own minutes |
| `server/web/test/browser/organisation-prices.test.ts:125` | fixed string `2026-10-18` | printed as given |
| `server/web/test/browser/member-profile.test.ts`, `developer-insights.test.ts`, `task-outside-id.test.ts` | — | LAI-773 added static figures and the OTLP block, no dates |
| `server/web/test/api/plan-limit.test.ts:39` | fixed local noon, `new Date(2026, 9, 17, 12)` | `now` is passed explicitly, and local constructors keep it zone-proof |
| `server/web/test/api/budgets.test.ts:144` | fixed `Date.UTC` | `now` passed explicitly |
| `server/test/services/{plan-limit,token-budgets,token-telemetry,token-usage,org-model-prices}.test.ts` | fixed `Date.UTC(2026, 9, 17, 12)` | no real clock |
| `server/test/http/routes/otlp.test.ts:48` | real `now` | the point is dated by its end (`token-telemetry.ts:732`), inside the server's window either side of midnight; it asserts one row of 420 |
| `server/test/http/routes/token-budgets.test.ts:99` | real | a membership's `createdAt`, never read |
| `cli/test/activity-usage.test.ts:46` | fixed `Date.UTC(2026, 9, 17, 10)`, Africa/Johannesburg | no real clock |
| `cli/test/activity-usage-command.test.ts:92`, `:246` | real | transcripts 0, 5 and 12 days back and a skip entry 60 s old; the asserted values are exclusions and counts, not days |

Nothing was found to fix beyond the plan-limit test.

## Discovered (not done here)

The same fallback glyph affects other List headers. Measured on this Mac,
here is how far each label's button ends inside its cell:

| header | cell | spare |
| --- | --- | --- |
| Key | 74px | 14.6px |
| Status | 104px | 20.7px |
| **Pri** | 58px | **2.5px**, which a 12.5px glyph would put about 2px past the cell on Linux |
| Effort | 88px → 96px | 3.8px → 11.8px |
| **Spr** | 46px | **−13.6px**: past its cell already, on a Mac |
| Assignee, Due, Created, Updated | — | ≥ 39px |

No test checks Pri or Spr, so neither fails the gate. A fix for every column
at once is to draw the resting glyph in a font Laika ships, or in a fixed-width
box. That is a design choice for SHELL. It is not filed as its own task here,
because the dispatch allocated only LAI-794.
