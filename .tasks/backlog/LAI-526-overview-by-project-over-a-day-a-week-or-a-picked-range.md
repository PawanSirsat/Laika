---
id: LAI-526
title: 'Overview shows time by project, and every figure follows Day, Week or a picked range — one summary of any stretch of days from the server'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-514
status: backlog
---

## Goal

The owner, 2026-10-26: *"in Overview also add the projects and show their
time for that day, and a filter there — the day, the week, or a custom
pick."* Overview's Week and Range scopes know each day's total and nothing
else, so they can say neither which project nor which task nor which kind
(LAI-514 said so on the card), and Range only picks among the open week's
days.

## Acceptance criteria

- [ ] `GET /me/time/summary?from=&to=` (and `GET /people/:id/time/summary`
      for a reader with `people.analytics.read`, logged as a look): over the
      days `from`–`to`, at most 92, the confirmed and drafted minutes, the
      meeting and off-screen minutes, the active days, and the minutes by
      day, by project, by task and by kind — read with the day view's own
      readers, so a task the reader cannot read is never named. SPEC §6.4.
- [ ] Overview: *By project* beside *By kind* and *By task* — each project's
      time, its share, a bar; *No project* for time on none.
- [ ] Day, Week and Range all show every figure — stats, by kind, by project,
      by task, and by day over several. Range is any stretch the reader picks:
      quick picks (last 7 days, last 30, this month, last month) or two dates.
- [ ] Loading and a failed read are drawn in the card; both themes; a phone.
- [ ] Server tests for the sums, the bounds and the people read; browser tests
      for the three scopes and the picker.

## Notes / context

Area is web and server both (D-033: the owner directed one task for the whole
change). `services/time-summary.ts` (new), `http/routes/time.ts`,
`http/routes/people.ts`; `api/time.ts`, `OverviewTab.tsx`, `overview-derive.ts`.
