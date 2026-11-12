---
id: LAI-1177
title: 'Time logging: joined_day is the earlier of the account day and the first day with time'
area: server
assignee: chief
priority: p1
depends-on: [LAI-1175]
discovered-from: LAI-1175
status: review
started: 2026-11-12T16:29:13+05:30
finished: 2026-11-12T16:29:13+05:30
---

## Goal

Owner, 2026-11-12: on the live grid, every imported person's October and early
November showed as muted "before they joined" — `joined_day` was
`users.created_at`, the import's day — so 8 h days drew no ✓ and the month
read *0 / 0 days*.

## Acceptance criteria

- [x] `GET /time/days` serves `joined_day` as the earlier of the account's day
      and the person's first filed day (live entry or pending draft, all time,
      not the stretch), in their zone; an account made today with an entry
      filed ahead keeps today.
- [x] Test: imported (entry a month before the account), drafted-only, deleted
      entry ignored, filed-ahead; mutation (account day alone) → red.
- [x] The index guard still refuses a scan; the first-day read is allowed its
      `(user, day)` index.
- [x] D-148 item 5 and SPEC §6.4 contract say so.
