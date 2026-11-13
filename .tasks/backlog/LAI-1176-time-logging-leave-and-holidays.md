---
id: LAI-1176
title: 'Time logging: leave and holidays — org_holidays, away periods kept 13 months and backdatable'
area: server+web
assignee: unclaimed
priority: p2
depends-on: [LAI-1175]
discovered-from: LAI-1175
status: backlog
---

## Goal

D-148 item 8 deferred leave and holidays from the Time logging grid: today a
public holiday, or a day a person was on leave, reads as a working day with
nothing on it — ✕ against *N / M days*. Make both **not due**, so the grid
stops asking people for hours on days nobody expected any.

Two things stand in the way, both recorded in D-148:

- the organisation has **no dated holidays** anywhere in the schema;
- **away periods are neither backdatable nor kept**: `availabilityFor` drops
  past ones, and `POST /me/availability/away` refuses a `to` before today
  (`422 away_in_past`), so a person cannot say *I was off last week* and a
  past month's leave is gone by the time anybody reads the grid.

## Acceptance criteria

- [ ] A new `org_holidays` table (`id`, `day`, `label`, `created_by`,
      `created_at`; `day` unique) with SPEC §4 entry; owner-set under
      `org.time.set`, session only: `GET /org/holidays`, `POST /org/holidays`
      body `{ day, label }` → 201, `DELETE /org/holidays/:id` → 204, in §6.4.
- [ ] An Organisation settings UI for the list (add a day with a label,
      remove one), on the page the time switch lives on, both themes, phone.
- [ ] Away periods are **kept 13 months** past their end and **backdatable**:
      `availabilityFor` keeps past periods within that window for the grid's
      read (the availability views themselves still show current and
      upcoming only), and `POST /me/availability/away` accepts a `to` before
      today — `away_in_past` goes, and the retention change is a decision,
      recorded in `docs/DECISIONS.md`.
- [ ] `GET /time/days` gains per person `away: [{ from, to }]` (the periods
      overlapping the stretch) and top-level `holidays: [{ day, label }]`;
      `TimeLoggingPersonView` / `TimeLoggingView` and the web mirrors and
      `PAIRS` updated.
- [ ] In the grid a holiday or a leave day is **not due**: a muted dash with
      the holiday's label or *on leave* in the words; it never counts against
      *M*; time logged on one counts toward hours as a day off's does. The
      legend says so.
- [ ] SPEC §4 (the table), §6.4 (the two endpoints and the grid's new fields),
      §11.4.2 and §11.4.2.1 (settings UI and the grid's wording) updated; the
      decision recording the retention change appended.
- [ ] Server and web tests for each bullet, including a mutation check that a
      holiday with time on it still counts toward hours and not days.

## Notes

- Filed by LAI-1175 (D-148 item 8). Until it lands, a holiday or a day on
  leave reads as a working day with nothing logged.
- Retention: 13 months covers "this month last year" with a month to spare;
  the §11.6 sweep that drops local-activity rows is the place for the
  deletion, with its own test.
