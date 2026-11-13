---
id: LAI-1185
title: 'Time logging grid and people: holidays and leave not due, On leave on the pill and profile (D-149)'
area: web
assignee: chief
priority: p1
depends-on: [LAI-1183]
status: in-progress
started: 2026-11-13T17:54:32Z
---

## Goal

LAI-1176's goal, fed by Clan: the Time logging grid stops asking for hours on
holidays and leave, and people's availability says "On leave".

## Acceptance criteria

- [ ] `time-logging-derive.ts` `cellState` gains `holiday` and `leave`
      before `off`: not due, muted with the label in the words; approved half
      day → due with `threshold_minutes / 2` for full/under; pending → no
      effect; `dueDays` excludes not-due days; time on a not-due day counts
      toward hours, never days; `CELL_WORDS`/glyphs and the legend; column
      heads `data-holiday` with the label.
- [ ] `availability-derive.ts` `pillOf`: "On leave until {date}" (type where
      sent), "Leave requested" for pending; `AvailabilityView`; profile
      `ThisWeekCard` day bars marked.
- [ ] Unit tests (derive) and browser tests extending `time-logging.test.ts`
      and the availability/profile fixtures; both themes × 1440/390.
      Mutations: half day owing the full threshold; pending making a day not
      due; a holiday with time counting toward days.

## Claim note

**Claimed against LAI-1183's committed contract (0d34ce7b), before LAI-1183 is accepted** — CHIEF's direction under §4.4 (the two halves of one contract are built together and land in one PR). The deviation from §2 step 1 is recorded here, not read loosely.
