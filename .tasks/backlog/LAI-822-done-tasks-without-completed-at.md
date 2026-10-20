---
id: LAI-822
title: 'Tasks created already done get no completed_at, so Laika''s 358 done tasks vanish from every ranged figure'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

Every done task has a `completed_at`, so ranged figures can see it.
**The backfill part needs the owner's yes, because it changes production
data.**

## Found (audit-metrics-sense, 2026-10-20)

`createTask` never stamps `completed_at` (`tasks.ts:777-803`). Laika's 358
done tasks were created already done on 10-15, so every range except All time
shows 0 done for Laika.

## Acceptance criteria

- [ ] **Code fix.** A task created as done, or created straight into
      done, gets `completed_at = created_at`, or `now`; match SPEC, and
      state it. A test fails on today's code.
- [ ] **Backfill, only after the owner says yes.** A migration sets
      `completed_at` for done tasks that lack one. Use the latest move into
      done from activity if there is one, otherwise `created_at`. It must
      be idempotent and reported, with a count before and after on a copy of
      production's snapshot, never on production itself.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
