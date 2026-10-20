---
id: LAI-820
title: 'My day "waiting on your review" lists every review task for an owner; review queue capped at 200 with no total; Inbox badge stuck at 99+; "No proof" mislabelled'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-810]
discovered-from: LAI-796
status: backlog
---

## Goal

The counts in My day, Inbox and the sidebar say how much is waiting **for
me**, and how much in total.

## Found (audit-metrics-sense, 2026-10-20)

- **My day's "Waiting on your review"** uses `can_decide`
  (`plate-derive.ts:94-102`). For an owner, that is every review task: 200,
  of which 37 are their own.
- **The review queue** is cut at 200 (`review.ts:129`) against 242 real, and
  the cut drops the newest.
- **The sidebar Inbox badge** is review (≤200) + unlisted (82), so it is
  always "99+".
- **The "No proof" tile** reads 200 of 200. It means "not finished through
  Laika".
- **The Insights badge** counts the 80% and 100% alerts for one subject as 2
  (`token-budgets.ts:1042`).
- **The week-strip "Drafted"** merges confirmed and drafted time
  (`my-day-derive.ts:249-253`).
- **The plate's "Blocked"** treats a cancelled blocker as finished, unlike the
  server.

## Acceptance criteria

- [ ] **Waiting on your review.** My day shows tasks waiting on *me*:
      assigned to me, or where I am the named reviewer if the model has one.
      Add a "+N more you can decide" link to Inbox.
- [ ] **Review total.** `GET /review` returns a true `total` alongside the
      capped list (needs-server: a named SPEC §6 edit). The Review tab and
      tile show it, or "200+".
- [ ] **Inbox badge.** The badge counts decidable review work that is mine.
      Unlisted gets its own dot or count. "No proof" is relabelled.
- [ ] **Insights badge.** It counts subjects, not alert levels.
- [ ] **Week strip.** Each day shows confirmed and drafted apart.
- [ ] **Plate blocked rule.** It matches the server's.
- [ ] **Tests.** They fail on today's code. Prove two by mutation.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

LAI-810 touches `plate-derive.ts` and `OnYourPlate.tsx`. Start this only after
LAI-810 is merged.
