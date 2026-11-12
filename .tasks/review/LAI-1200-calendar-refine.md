---
id: LAI-1200
title: 'Refine the Calendar space tab: calm sprint band, readable chips, keyboard grid, 390 agenda'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
finished: 2026-11-11T13:30:00Z
started: 2026-11-11T10:00:00Z
---

## Goal

The Calendar tab's body reads as a calm month/week grid: ordinary sprint days
are neutral (the audit found them tinted red, so normal days looked overdue),
only overdue work is flagged, and the grid is operable from the keyboard and
readable at 390px. Visual audit #12, `calendar-1440-dark.png`.

Scope is the calendar screen body only (`server/web/src/routes/screens/calendar/`
and its tests). Not the space header/toolbar (LAI-1198), not error/Retry
states (PR #280), not how a task opens (PR #289).

## Acceptance criteria

- [x] Readable month and week grid; today clearly marked.
- [x] Normal days neutral: no red/warning tint for an ordinary sprint day;
      red only for an overdue task.
- [x] Sprint ranges shown as a calm band with a label.
- [x] Task chips show key + title + status/priority without overflow; a day
      with more than fits shows `+N more`, which opens a day list.
- [x] Keyboard: roving tabindex over days; arrows move day focus; Enter opens
      the day list (or the task when the day has one); PageUp/PageDown change
      month; Home/End go to the week's edges. Each day has an SR label such as
      "Tuesday 12 November, 3 tasks, 1 overdue".
- [x] Empty month state with a next action.
- [x] Month/week switch and Today button, labelled.
- [x] At 390px an agenda/list layout replaces the squeezed grid.
- [x] Both themes; reduced motion respected; theme tokens only (theme.css
      untouched). Existing public API only, no new deps, no demo data.
- [x] Playwright: keyboard grid nav, `+N more` day list, no red tint on
      ordinary days, overdue still flagged, 390 agenda. Mutated once to prove
      they fail.
- [x] Gate: `pnpm lint`, `pnpm format`, server/web typecheck and the sharded
      server/web test script each exit 0.

## Notes (SHELL, 2026-11-11)

- Scope held to `server/web/src/routes/screens/calendar/` plus two new test
  files. The space header/toolbar (LAI-1198), error/Retry (PR #280) and how a
  task opens (PR #289) are untouched; the calendar's own controls live in a
  bar inside the calendar body.
- Mutations, each anchor-checked and restored by byte copy: sprint band in the
  overdue palette; sprint day tinted; arrow keys ignored; no `+N more`; no
  agenda; overdue unflagged; `addDays` by milliseconds (DST). Each reddened the
  test that names it.
- Screenshots: `.polly/screenshots/calendar/` (1440/390, dark/light, plus day
  list, week and empty month at 1440).
