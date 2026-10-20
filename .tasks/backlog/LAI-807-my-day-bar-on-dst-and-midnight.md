---
id: LAI-807
title: 'My day''s day bar places blocks by minutes since midnight, so on a clock-change day a block draws an hour off, and nothing tests a block past midnight'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

The day bar draws each block at the clock time the person sees, on every day
of the year.

## Found (LAI-796 review, run against the real module)

`server/web/src/routes/screens/my-day/day-timeline.ts` positions blocks by
elapsed minutes since local midnight. On 2026-10-25 in Europe/London, a 22:00
block draws at 23:00 and is clipped. On a spring-forward day, a 03:30 end
draws at 02:30. Nothing crashes.

## Acceptance criteria

- [ ] Blocks are placed by wall-clock time in the entry's own zone (D-088
      item 12).
- [ ] Tests for a fall-back day, a spring-forward day, and a block that
      crosses midnight (clipped at the day's edge, shown on both days or
      however SPEC §11.4.2.1 says). Each fails on today's code.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
