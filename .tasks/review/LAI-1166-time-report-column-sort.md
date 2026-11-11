---
id: LAI-1166
title: 'Time report: sort by any column header, up or down'
area: web
assignee: chief
priority: p2
depends-on: [LAI-1164]
status: review
started: 2026-11-06T20:22:01+05:30
finished: 2026-11-06T20:22:01+05:30
---

## Goal

Owner, 2026-11-06: in every Time report, sort the table by any column, up or
down (D-144).

## Acceptance criteria

- [x] Every column header (name, Spaces, Tasks, Confirmed, Drafted, Total) is a
      button: the first click A–Z or the largest first, the next the other way;
      `aria-sort` says which; time on nothing stays last; children follow the
      same key where they have it.
- [x] The default order is unchanged (people A–Z, the rest largest first); the
      *A–Z · Most time* switch is gone, *Total* does its job.
- [x] D-144; SPEC §11.4.2.1.
- [x] Tests: derive (nextSort, both directions, none last), browser (Total,
      Tasks, name both ways, aria-sort, donut follows).
