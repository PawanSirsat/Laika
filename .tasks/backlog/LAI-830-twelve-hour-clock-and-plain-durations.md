---
id: LAI-830
title: 'Times show on a 12-hour clock with AM/PM everywhere, and durations say "19 min" or "1 h 9 min" instead of "0:19"'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-810
status: backlog
---

## Goal

Every time and duration in the web app reads without guessing. Owner,
2026-10-21, with two crops of My day's Confirmed list ("14:29–14:48 ·
confirmed draft", durations "0:19", "0:15", "0:08", header "entries · 1:09"):

> *"I want to show a 12-hour clock everywhere in the web app, also show AM/PM;
> then here, is this minutes or hours? That's a little confusing, so do it."*

Made on the owner's direct instruction.

## Acceptance criteria

- [ ] **One formatter.** All clock times in the web app go through one shared
      helper that prints a 12-hour clock with AM/PM: `2:29 PM`, ranges as
      `2:29–2:48 PM` (one AM/PM when both ends share it) or
      `11:40 AM–12:10 PM` when they don't. Dates with a time: `20 Oct, 2:29 PM`.
      Census first: list every place a time is formatted (no `head` on the
      grep: `toLocaleTimeString`, `Intl.DateTimeFormat`, `hour:`, `HH:mm`-style
      templates, `getHours`, hand-built `padStart` clocks), and move each onto
      the helper. Record the census in the task file.
- [ ] **One duration formatter.** Durations never print as `h:mm`. They print
      `19 min`, `1 h 9 min`, `2 h`, `3 d 4 h` (rounded sensibly, `< 1 min`
      for under a minute). My day's rows, totals ("1 h 9 min"), the week strip,
      the day bar tooltips, agent minutes, the selection bar ("10 selected ·
      2 h 50 min"), Effort ranges, cycle and review-wait times, Capacity,
      Insights and the profile all use it. Census as above.
- [ ] **Inputs still accept what people type.** Time inputs (My day "Add
      time", Minutes…, Split…) accept `45`, `45m`, `1h 30m`, `1:30` and show
      what they understood before saving. Stored values do not change (minutes
      and timestamps are unchanged on the wire).
- [ ] **Machine-readable copies stay.** Anything exported, copied as a
      command, or sent to agents (MCP text, CLI output) is unchanged in this
      task; this is the web app's display only. Note any CLI output that
      would benefit and file it rather than change it.
- [ ] **Flaky clock tests fixed while here.** `member-profile.test.ts` asserts
      exact minutes ("active 2 min") against a moving clock and failed under
      load in two builders' gates on 2026-10-20/21. Pin its clock (or assert
      what the code computed from a fixed `now`) so it cannot drift by a
      minute. Run it 10 times in a row and once under load.
- [ ] **Tests.** Unit tests for both helpers (midnight, noon, AM/PM span,
      same-period range, 0 and 59 min, 60 min, 1 day+, rounding). Browser
      tests that My day shows `2:29–2:48 PM` and `19 min` where it showed
      `14:29–14:48` and `0:19`. Each fails on today's code.
- [ ] **Screenshots** before and after of My day, the task panel's Effort and
      activity, Capacity and Insights, light and dark, 1440 and 390.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Locale: the owner wants a 12-hour clock regardless of the browser's locale.
  Use explicit options (`hour: 'numeric', minute: '2-digit', hour12: true`),
  not the locale default. Time zone handling is unchanged.
- LAI-827 (task panel editor) and LAI-828 (type scale) are in flight; touch
  their files only where a time or duration is printed, and merge master
  before finishing.
