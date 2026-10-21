---
id: LAI-832
title: 'Contributors and Capacity follow-ups: backlog shown apart at 390, one stale rule everywhere, exact Delivered wording, tab overflow, untested cases'
area: web
assignee: chief
priority: p2
depends-on: [LAI-817, LAI-818]
discovered-from: LAI-817
status: in-progress
started: 2026-10-21T05:37:16Z
---

## Goal

Close the non-blocking findings from the LAI-817 and LAI-818 reviews
(2026-10-21) so the Dashboard and Capacity say exactly what they count
(D-092).

## Acceptance criteria

- [ ] **Backlog shown apart on Open work now (D-092 §3).** The person count
      excludes backlog, the same way review is already left out, or the
      backlog part stays visible at 390 px. Today the detail line is cut off,
      so 78 reads as load when about 50 of it is backlog.
- [ ] **One stale rule (D-092 §4).** `board-derive.ts` `STALE_DAYS` (5 days
      untouched) still drives the Activity screen's stale panel
      (`ActivityPanels.tsx`) and the List's amber marker (`list-derive.ts`).
      Both use the server's `stale_flagged_at` instead. Remove the client
      rule.
- [ ] **Delivered wording.** The footnote and column title say "moved into
      review, or straight into done" (`Contributors.tsx`). The All-time empty
      state reads properly instead of "…or done all time."
- [ ] **Needs attention tabs at 390.** The third tab's count no longer runs
      into the card edge (`.dash-tabs` in `dashboard.css`).
- [ ] **Review wait does not move with the range.** "Waiting for review >
      5 days" uses the real time of the move into review. Today it falls back
      to `min(updated_at, rangeStart)`, so a task 10 days in review drops out
      on "Last 24 hours".
- [ ] **Tests for cases that work but are untested:**
      - two people moving the same task into review;
      - a reader who can see one space but not another, checking that their
        overall Capacity load leaves the hidden space out;
      - the drift check comparing `extends CapacityWorkload`.
- [ ] **Capacity's "No work" chip versus the "No load" badge.** Decide
      whether the chip becomes "No load". Write the decision and its reason
      in this file.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
