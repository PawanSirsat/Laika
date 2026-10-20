---
id: LAI-818
title: 'Capacity calls everyone Heavy: load counts review and backlog, overdue triggers it, the badge ignores the selected space, and board activity counts bookkeeping'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

Capacity's load badge and counts reflect committed work (D-092 item 3), so
"Heavy" means something. **D-092 is the contract.**

## Found (audit-metrics-sense, 2026-10-20, production)

- **`loadOf`** (`server/src/services/presence.ts:446-451`) returns heavy if
  in progress is over 5, **or** anything is overdue, **or** open is over 15.
  Open includes backlog and review.
- **In review is counted as the assignee's load** (`presence.ts:474-475`):
  Pawan 77, Ashutosh 163 (Sauce 123 plus OnRoute 40, median wait 19 days).
- **"To do" includes backlog** (`presence.ts:476`, `CapacityCard.tsx:175`):
  Pawan's 257 is 209 backlog plus 47 to do.
- **The space chips** count backlog and review too (`presence.ts:707-722`).
  Laika's 254 drops to 28 committed. Every Laika card is assigned to the owner
  by convention.
- **The badge reads the global load** (`CapacityCard.tsx:114`) while the counts
  read the selected space (`:66`). The "Heavy load" chip
  (`capacity-derive.ts:96-97`) does the same.
- **"Board activity · 2714"** (`db/activity.ts:95-114`, `presence.ts:812-818`):
  2,547 of Pawan's 2,717 are agent rows, mostly bookkeeping (680 created,
  656 sprint moves, 546 edits and reorders). The rollup already stores
  `by_self` and `by_agents`.
- **The "Waiting for review" tile** is capped at 200 (`review.ts:30,129`). The
  real total is 242.
- **Team load** (`capacity-derive.ts:250-258`) uses the same open-work rule.

## Acceptance criteria

- [ ] **Server load.** Load is in progress plus to do. The thresholds apply
      to that number, with the values stated in SPEC §11.4.2.1 or wherever
      Capacity is specified (a named edit). Overdue no longer makes a person
      Heavy; the payload carries it as its own field.
- [ ] **Counts.** Each card shows **in progress · to do · backlog** apart, and
      **waiting for review** apart, labelled as waiting on reviewers. Space
      chips use committed work, with backlog available on hover or as a
      second figure.
- [ ] **Per-space badge.** With a space selected, the badge and the "Heavy
      load" filter use that space's load. The server sends it, or the web
      applies the same rule to the per-space counts; say which.
- [ ] **Activity.** Board activity shows work done by the person apart from
      work done by their agents, for example "14 days · 170 by you · 2,547 by
      agents". Bookkeeping verbs (sprint moves, reorders) are excluded from
      the figure, or shown apart; say which.
- [ ] **Review total.** The tile shows the true total from the server, or
      "200+" when capped. Do not raise the cap.
- [ ] **Contract.** The client and server types stay in step, with drift
      checks green.
- [ ] **Tests.** They fail on today's code:
      - a person with 0 in progress, 0 to do and 100 in review is not Heavy;
      - overdue alone is not Heavy;
      - the per-space badge;
      - the activity split.
      Prove two by mutation.
- [ ] **Screenshots.** Before and after, light and dark, 1440 and 390, in
      `/tmp/laika-capacity-shots/`.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
