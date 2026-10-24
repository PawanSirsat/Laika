---
id: LAI-502
title: 'My day: the header from the design — Start timer, Add time, Day settings menu with Follow my laptop, Who looked and ? buttons, the Draft-off banner, the phone header'
area: web
assignee: chief
priority: p1
depends-on: [LAI-500]
discovered-from: LAI-897
status: review
finished: 2026-10-24T11:07:30Z
started: 2026-10-24T10:09:46Z
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

- [x] Start timer: popover with task chips, kinds, a title; running pill with a live clock, Pause / Resume, Stop; a 409 on stop opens the editor on the timer's range prefilled; `T` starts or stops; both themes.
- [x] Add time in the header opens the new-entry panel on the last free 30 minutes before now, or untimed when the day has none; the old form under the list is gone and every test that drove it is re-aimed.
- [x] Day settings menu: Draft my time, Where you are with *Follow my laptop* (`place: null`), the caption from the design.
- [x] Who looked and `?` are header buttons; the side column keeps Agent time and On your plate.
- [x] Draft-off banner with Turn on when drafts are off and the organisation is in `drafts`.
- [x] Phone (container ≤ 34rem): ‹ day › header, letter week strip, timer dot + clock + Stop, Add time, Day settings; a summary row with Confirm.
- [x] Browser tests in both themes; the MOCKUP guard stays green; type floor 12px.

## Notes / context

D-110. Builds against LAI-500's API.

## Notes from the build (CHIEF, 2026-10-24)

- The header's controls are `TimerControl`, `DaySettings` and `WhoLooked`
  over one `HeaderPopover` (click away and Esc close it; a dialog or a
  dropdown list a control inside opened counts as inside). The timer pill
  ticks each second on its own clock; Pause and the amber are the design's.
- *Add time* opens the new-entry panel on the last free half hour before now,
  or with *No set time* ticked when there is none; the panel's new checkbox
  posts a length alone, which is what the old form's untimed path did.
- A stop the clock refuses opens the panel on the timer's span with its card,
  kind and title filled, and the timer is discarded once that entry is saved.
- Two browser fixtures built the day by hand without `timer`, and the pill
  crashed the page on `undefined`; both carry it now, and the control treats
  a missing timer as none.
- Nine re-aims across six suites: the old form's selectors, the side card's
  rows, Draft my time and Where you are inside Day settings, the week's
  scroll on a phone (it fits now, a letter a day), the write-control list.
- The owner, on seeing it: the editor belongs in the right column, opened by
  tapping any time — LAI-508, filed from this task.
