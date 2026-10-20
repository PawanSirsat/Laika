---
id: LAI-838
title: '`laika time draft` prints blocks on a 24-hour clock while the web app shows 2:29–2:48 PM'
area: cli
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-830
status: backlog
---

## Goal

LAI-830 put every time of day in the web app on a 12-hour clock with AM/PM,
on the owner's instruction (*"a 12-hour clock everywhere in the web app"*).
It changed nothing the CLI prints: that was out of its scope ("Machine-
readable copies stay … note any CLI output that would benefit and file it").

`cli/src/activity.ts:1021` `clock()` formats a drafted block's times as
`HH:MM` with `hourCycle: 'h23'` for `laika time draft`, so the same block
reads `14:29–14:48` in a terminal and `2:29–2:48 PM` on My day. The CLI's
durations already read `3 h 12 min` (`span()`, `activity.ts:1031`) and need
nothing. `cli/src/time-solidtime.ts:220` `wall()` is arithmetic, not output.

## Acceptance criteria

- [ ] Decide with the owner whether terminal output follows the web app's
      12-hour clock; record the answer here.
- [ ] If it does: `laika time draft` prints `2:29–2:48 PM` (one AM/PM when
      both ends share it), and `--json` is unchanged.
- [ ] Tests for the printed form that fail on today's code.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
