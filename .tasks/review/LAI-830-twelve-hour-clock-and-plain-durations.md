---
id: LAI-830
title: 'Times show on a 12-hour clock with AM/PM everywhere, and durations say "19 min" or "1 h 9 min" instead of "0:19"'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-810
status: review
started: 2026-10-20T19:45:45Z
finished: 2026-10-20T20:46:09Z
---

## Goal

Every time and duration in the web app reads without guessing. Owner,
2026-10-21, with two crops of My day's Confirmed list ("14:29–14:48 ·
confirmed draft", durations "0:19", "0:15", "0:08", header "entries · 1:09"):

> *"I want to show a 12-hour clock everywhere in the web app, also show AM/PM;
> then here, is this minutes or hours? That's a little confusing, so do it."*

Made on the owner's direct instruction.

## Acceptance criteria

- [x] **One formatter.** All clock times in the web app go through one shared
      helper that prints a 12-hour clock with AM/PM: `2:29 PM`, ranges as
      `2:29–2:48 PM` (one AM/PM when both ends share it) or
      `11:40 AM–12:10 PM` when they don't. Dates with a time: `20 Oct, 2:29 PM`.
      Census first: list every place a time is formatted (no `head` on the
      grep: `toLocaleTimeString`, `Intl.DateTimeFormat`, `hour:`, `HH:mm`-style
      templates, `getHours`, hand-built `padStart` clocks), and move each onto
      the helper. Record the census in the task file.
- [x] **One duration formatter.** Durations never print as `h:mm`. They print
      `19 min`, `1 h 9 min`, `2 h`, `3 d 4 h` (rounded sensibly, `< 1 min`
      for under a minute). My day's rows, totals ("1 h 9 min"), the week strip,
      the day bar tooltips, agent minutes, the selection bar ("10 selected ·
      2 h 50 min"), Effort ranges, cycle and review-wait times, Capacity,
      Insights and the profile all use it. Census as above.
- [x] **Inputs still accept what people type.** Time inputs (My day "Add
      time", Minutes…, Split…) accept `45`, `45m`, `1h 30m`, `1:30` and show
      what they understood before saving. Stored values do not change (minutes
      and timestamps are unchanged on the wire).
- [x] **Machine-readable copies stay.** Anything exported, copied as a
      command, or sent to agents (MCP text, CLI output) is unchanged in this
      task; this is the web app's display only. Note any CLI output that
      would benefit and file it rather than change it.
- [x] **Flaky clock tests fixed while here.** `member-profile.test.ts` asserts
      exact minutes ("active 2 min") against a moving clock and failed under
      load in two builders' gates on 2026-10-20/21. Pin its clock (or assert
      what the code computed from a fixed `now`) so it cannot drift by a
      minute. Run it 10 times in a row and once under load.
- [x] **Tests.** Unit tests for both helpers (midnight, noon, AM/PM span,
      same-period range, 0 and 59 min, 60 min, 1 day+, rounding). Browser
      tests that My day shows `2:29–2:48 PM` and `19 min` where it showed
      `14:29–14:48` and `0:19`. Each fails on today's code.
- [x] **Screenshots** before and after of My day, the task panel's Effort and
      activity, Capacity and Insights, light and dark, 1440 and 390.
- [x] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Locale: the owner wants a 12-hour clock regardless of the browser's locale.
  Use explicit options (`hour: 'numeric', minute: '2-digit', hour12: true`),
  not the locale default. Time zone handling is unchanged.
- LAI-827 (task panel editor) and LAI-828 (type scale) are in flight; touch
  their files only where a time or duration is printed, and merge master
  before finishing.

## Census (LAI-830, taken 2026-10-21 on `622a26de`, before any change)

Commands, run over `server/web/src` with no `head`, `*.test.*` excluded:

```
grep -rnE 'toLocaleTimeString|Intl\.DateTimeFormat|hour:|HH:mm|getHours|getUTCHours|hour12|hourCycle|toLocaleString\(|timeStyle|toLocaleDateString' src
grep -rnE 'padStart\(2' src ;  grep -rnE '\}:\$\{' src ;  grep -rnE 'const (two|pad|pad2)\b' src
grep -rnE '\bhm\(|agentMinutes\(' src
grep -rnE '/ ?(60_?000|3_?600_?000|86_?400_?000|MINUTE|HOUR|DAY|…_MS)\b|/ ?60\)|% ?60\b' src
grep -rnE '\$\{[^}]+\} ?(minutes?|hours?|days?|hrs?|mins?)\b' src   # plus the min/h/d literal sweep
```

Every hit was read; dates without a time (`toLocaleDateString` for a day,
`Number#toLocaleString` for a count, `${a}:${b}` keys) are not clock times
and are left out below.

### Clock times — every one moves to `clockTime` / `clockRange` / `dateTime` (`src/api/time-label.ts`)

| # | Site | Printed today | Where it shows |
| --- | --- | --- | --- |
| C1 | `my-day/my-day-derive.ts` `clockIn` / `rangeLabel` | `14:29–14:48` | My day rows, Split…'s label, bulk-confirm reports, row names |
| C2 | `my-day/DayBar.tsx` hour ticks (`pad(hour)`) | `08 10 12` | My day's day bar |
| C3 | `my-day/EntryRow.tsx:245` revision time (`toLocaleString('en-GB', hour '2-digit')`) | `20 Oct, 14:29` | My day › entry › History |
| C4 | `api/time-label.ts:70,84` `timeLabel` text and `full` | `27 Sep, 14:05`, `Sat 27 Sep 2026, 14:05:31` | List CREATED/UPDATED, task panel, Capacity tooltips, profile, unlisted, evidence |
| C5 | `api/plan-limit.ts:104` `clockLabel` (`en-GB`, `2-digit`) | `15:40`, `Mon 09:00` | Usage › plan limit forecast |
| C6 | `api/plan-limit.ts:111` `minuteLabel` (hand-built `padStart`) | `09:00` | Usage › plan limit reset, and its input's initial value |
| C7 | `BoardScreen.tsx:1356` board "as of" (`toLocaleTimeString([], 2-digit)`) | locale's | Board refresh-failed note |
| C8 | `dashboard/DashboardScreen.tsx:490` dashboard "as of" | locale's | Dashboard refresh-failed note |
| C9 | `board/TaskDetailPanel.tsx:473,1047` activity time (`toLocaleString()`) | locale's date+time | Task panel › Activity |
| C10 | `profile/ProfileScreen.tsx:825-826` since (`toLocaleString()`) | locale's | Profile › work row tooltip |
| C11 | `activity/ActivityPanels.tsx:49` `clock` (`hour12: false`) | `14:05:31` | Activity rail |
| C12 | `activity/ActivityPanels.tsx:203` last seen (`toLocaleTimeString()`) | locale's | Activity rail › sessions |
| C13 | `projects/ProjectContextPanel.tsx:202` last edited (`toLocaleString()`) | locale's | Space brief |
| C14 | `demo/agent-runtime.ts:75` demo claim lock (hand-built) | `14:05` | demo only |

Not a clock time, left alone: `my-day-derive.ts:37` `wallOf` (`hourCycle: 'h23'`
is arithmetic for `dayIn`/`atClock`, never printed); `usage.ts:307` reads the
zone name.

### Durations — every one moves to `formatDuration` (`src/api/duration.ts`)

| # | Site | Printed today | Where it shows |
| --- | --- | --- | --- |
| D1 | `my-day/my-day-derive.ts:116` `hm` → 19 callers in `EntryRow`, `DraftRow`, `MyDayScreen`, `DraftList`, `EntryList`, `draft-bulk`, `weekCell`, `day-timeline` | `0:19`, `1:09` | My day rows, totals, selection bar, Confirm day, week strip, day bar tooltips, reports, Minutes… prefill |
| D2 | `my-day/my-day-derive.ts:126` `agentMinutes` | `142 min` | My day › Agent minutes — **stays minutes** (D-088 item 8: agent time "never as hours") |
| D3 | `api/estimates.ts` `buildShown` / `roughShown` / `inDays` / `lowText` | `1.5 h`, `40 min–1.5 h`, `0.5 d` | Task panel › Effort, effort chip title, Review |
| D4 | `api/review.ts:293` `waitingFor` | `3 h`, `2 d` | Review queue waits |
| D5 | `api/usage.ts:429` `spentLabel` | `6.0 h` | Insights › Usage forecast |
| D6 | `api/budgets.ts:162` `runawayLine` | `45 min`, `3 h` | Task panel › Tokens runaway banner |
| D7 | `board/BoardInsights.tsx:13` `duration` | `3d 4h`, `40m` | Board › Insights cycle time |
| D8 | `dashboard/Throughput.tsx:5` | `40m`, `5h`, `3d` | Dashboard cycle time |
| D9 | `capacity/capacity-derive.ts:179` `statusText` away | `Away · 23 min` | Insights › Capacity |
| D10 | `capacity/capacity-derive.ts:267` `oldestAge` | `4h`, `3d` | Insights › Capacity |
| D11 | `profile/profile-derive.ts:32` `durationLabel` | `1.8 d`, `5 h` | Profile |
| D12 | `activity/ActivityPanels.tsx:230` idle | `6d idle` | Activity rail › Stale |

### Relative times — "when", not "how long": recorded, unchanged here

`time-label.ts` `timeLabel` (`4 min ago`, `3 h ago`, owner-chosen, D-065);
`board-derive.ts` `staleFor`/`updatedAge` (`2h`, kept compact for the card
footer, D-065); `tokens.ts:167` (`Used 3m ago`); `ProjectStats.tsx:26` and
`task/TaskMeta.tsx:77` (`3m ago`); `dashboard-derive.ts:291` (`3 minutes
ago`); `InviteScreen.tsx:50` and `OrganisationScreen.tsx:72` (`expires in 6
days`); `TimelineScreen.tsx:65` (`starts in 3d`); `ConnectScreen.tsx:1507`
(a fixed polling window in copy). The `3m`/`3h` forms are filed as their
own task rather than widened into this one.

### Inputs

| # | Input | Accepts today | Change |
| --- | --- | --- | --- |
| I1 | My day › Add time › How long | `90`, `1:30`, `1h30`, `45m`, `1.5h` | also `1h 30m`, `1 h 30 min`, `45 min`; shows what it understood |
| I2 | My day › entry › Edit › How long | as I1 | as I1; prefilled in the new form |
| I3 | My day › draft › Minutes… | as I1 | as I1; prefilled in the new form |
| I4 | My day › draft › Split… | `10:15` (24-hour only) | also `2:35 PM`, `2:35pm`, and `2:35` read inside the block; shows what it understood |
| I5 | Usage › plan limit › resets at | `09:30` | also `9:30 AM`; prefilled as `9:00 AM` |

Stored and sent values do not change: `parseMinutes`, `atClock` and
`parseMinute` still return minutes and instants.

### Machine-readable copies — not changed

The CLI already prints durations as `3 h 12 min` (`cli/src/activity.ts:1031`,
`cli/src/time-solidtime.ts:244`). It prints clock times as 24-hour `HH:MM`
(`cli/src/activity.ts:1021`, `cli/src/time-solidtime.ts:220`): filed, not
changed. MCP text is the server's and is untouched.

## Outcome (LAI-830, for review)

**The two helpers.** `server/web/src/api/time-label.ts` — `clockTime`
(`2:29 PM`, optional zone and seconds), `clockRange` (`2:29–2:48 PM`,
`11:40 AM–12:10 PM`), `dateTime` (`20 Oct, 2:29 PM`), `hourLabel` (`8 AM`),
`minuteClock` (`9:00 AM` for a stored minute-of-day) and `parseClock`; built
from `Intl` `en-US` parts with `hour12: true`, joined with an ordinary space.
`server/web/src/api/duration.ts` — `formatDuration` / `formatDurationMs`
(`< 1 min`, `19 min`, `1 h 9 min`, `2 h`, `3 d 4 h`: to the minute under a
day, to the hour from a day) and `shownMinutes`. Every C- and D-row of the
census above calls them; re-running the census on the merged tree finds only
the rows recorded as not a clock or as relative time.

**Decisions a reviewer should check.**
- Agent minutes go through the helper with `largest: 'min'` and stay `142 min`:
  D-088 item 8 says agent time is shown "never as hours".
- Effort keeps LAI-785's settled rounding (5-minute steps, half hours under
  10 h, hours under two days, whole days beyond) and prints it through the
  helper with `largest: 'h'` under two days, so `20–30 h` and `1–2 d` stay. Half
  a day, once `0.5 d`, now reads `12 h` (`12 h–3 d`); the "never `24 h`" guard
  in `estimates.test.ts` still holds. A time that *happened* is now to the
  minute (`took 1 h 36 min`, was `1.6 h`), so a verdict can move by the
  rounding it no longer hides: `1–2 d · took 2 d 10 h` is `a little over`
  where `2 d` was `on target`. Still judged on the printed values.
- `Split…` reads a bare `2:35` as whichever of AM/PM falls inside the block.
- Relative times (`3 min ago`, card footer `2h`, `Used 3m ago`) are "when",
  not "how long", and are filed as LAI-837 rather than widened into this.

**Verification.**
- Failing first, on `622a26de`: `node --test test/api/duration.test.ts
  test/api/time-label.test.ts` (module/exports missing; exit 1) and
  `node --test test/browser/my-day.test.ts` — exit 1, 3 of 6 failing:
  `actual: '14:29–14:48'` vs `2:29–2:48 PM`, `actual: 'Confirm day · 1:35'`,
  and no *Reads as* line.
- `member-profile.test.ts` pinned with `page.clock.setFixedTime(NOW)`: 10 runs
  in a row, 37/37 each, exit 0; once more under 10 extra CPU burners (load
  average 39.7 on 10 cores), 37/37, exit 0. Shifting the pin 90 s reproduces
  the gate failure exactly (`active 3 min ago`), so the pin is what holds it.
- Gate on `5a0c3ce0` (after `git merge master`): `pnpm test` exit 0 (web
  2466/2466 test cases, server 3327 passed + 10 skipped, cli 533 passed + 2
  skipped), `pnpm lint` exit 0, `pnpm format` exit 0. The first gate run
  exited 1 on one assertion the census missed (`task-tokens.test.ts`
  `/landed for 7\d min/`); fixed in `5a0c3ce0`.
- Screenshots, before and after, light and dark, 1440 and 390:
  `/tmp/laika-clock-shots/{before,after}-{my-day,task-panel-effort-activity,task-panel-activity,capacity,insights-usage}-{light,dark}-{1440,390}.png`.
  Capacity's fixture changed between the two (LAI-818 merged in between).
