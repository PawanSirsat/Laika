---
id: LAI-502
title: 'My day: the header from the design — Start timer, Add time, Day settings menu with Follow my laptop, Who looked and ? buttons, the Draft-off banner, the phone header'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-500]
discovered-from: LAI-897
status: backlog
---

## Goal

D-110 items 1, 10 and 11: the header as designed, minus the *Who can see this*
popover and *Fill gaps*. Start timer popover and running pill (pause, resume,
stop; `T`), Add time in the header opening the range panel, Day settings
holding Draft my time and Where you are plus *Follow my laptop*, Who looked as a
header button with a count, a `?` button for the shortcut sheet, the *Draft my
time is off* banner with *Turn on*, and the phone header ‹ day › with a letter
week strip. `AddTimeForm` leaves the Confirmed list.

## Acceptance criteria

- [ ] Start timer: popover with task chips, kinds, a title; running pill with a live clock, Pause / Resume, Stop; a 409 on stop opens the editor on the timer's range prefilled; `T` starts or stops; both themes.
- [ ] Add time in the header opens the new-entry panel on the last free 30 minutes before now, or untimed when the day has none; the old form under the list is gone and every test that drove it is re-aimed.
- [ ] Day settings menu: Draft my time, Where you are with *Follow my laptop* (`place: null`), the caption from the design.
- [ ] Who looked and `?` are header buttons; the side column keeps Agent time and On your plate.
- [ ] Draft-off banner with Turn on when drafts are off and the organisation is in `drafts`.
- [ ] Phone (container ≤ 34rem): ‹ day › header, letter week strip, timer dot + clock + Stop, Add time, Day settings; a summary row with Confirm.
- [ ] Browser tests in both themes; the MOCKUP guard stays green; type floor 12px.

## Notes / context

D-110. Builds against LAI-500's API.
