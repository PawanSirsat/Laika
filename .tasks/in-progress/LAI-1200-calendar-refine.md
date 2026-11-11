---
id: LAI-1200
title: 'Refine the Calendar space tab: calm sprint band, readable chips, keyboard grid, 390 agenda'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
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

- [ ] Readable month and week grid; today clearly marked.
- [ ] Normal days neutral: no red/warning tint for an ordinary sprint day;
      red only for an overdue task.
- [ ] Sprint ranges shown as a calm band with a label.
- [ ] Task chips show key + title + status/priority without overflow; a day
      with more than fits shows `+N more`, which opens a day list.
- [ ] Keyboard: roving tabindex over days; arrows move day focus; Enter opens
      the day list (or the task when the day has one); PageUp/PageDown change
      month; Home/End go to the week's edges. Each day has an SR label such as
      "Tuesday 12 November, 3 tasks, 1 overdue".
- [ ] Empty month state with a next action.
- [ ] Month/week switch and Today button, labelled.
- [ ] At 390px an agenda/list layout replaces the squeezed grid.
- [ ] Both themes; reduced motion respected; theme tokens only (theme.css
      untouched). Existing public API only, no new deps, no demo data.
- [ ] Playwright: keyboard grid nav, `+N more` day list, no red tint on
      ordinary days, overdue still flagged, 390 agenda. Mutated once to prove
      they fail.
- [ ] Gate: `pnpm lint`, `pnpm format`, server/web typecheck and the sharded
      server/web test script each exit 0.
