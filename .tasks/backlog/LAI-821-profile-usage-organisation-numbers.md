---
id: LAI-821
title: 'Profile "Delivered" credits the wrong person; Usage cost-per-accepted and rework read only the unused Accept button; Organisation hides the owner from its members tile'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

Profile, Usage and Organisation figures follow D-092 and count what really
happened.

## Found (audit-metrics-sense, 2026-10-20)

- **Profile "Delivered / accepted"** (`profiles.ts:386-388`) counts moves into
  done by someone else, on tasks assigned to the person now. Pawan gets 0.
  Ashutosh gets 38, and 37 of those are Pawan's moves.
- **Profile review "median to decide"** counts bulk and agent moves: 46 of
  Pawan's 85 are the 10-07 sweep.
- **Usage "Cost per accepted task" and "Rework"** read only the Review
  screen's Accept and Send back (`token-usage.ts:1344,1495`). Nobody uses
  them: 0 in 14 days. Meanwhile 208 tasks were done and 13 sent back in
  30 days.
- **Usage "Per day"** divides by every day in the range, but the data starts
  on 10-16.
- **The Organisation members tile** counts strictly `admin`
  (`OrganisationScreen.tsx:294,322`), so the owner never appears.
- **Organisation "Open tasks"** per space includes review: Sauce's 139 is 123
  in review.

## Acceptance criteria

- [ ] **Profile Delivered.** It credits whoever moved the task into review,
      or into done without review, with an agent counted as its token owner
      (D-092 item 1). Reviewed is counted apart.
- [ ] **Usage accepted and rework.** "Accepted" means any move into done,
      and "Rework" any move from review back to in progress or to do, not
      only the buttons. Labels say so. SPEC §6.4 is a named edit if the
      definition changes.
- [ ] **Usage per day.** It divides by the days with data, or says "since
      10-16".
- [ ] **Organisation.** The members tile shows "1 owner · N admins · M
      members". Open tasks per space show waiting-for-review apart.
- [ ] **Tests.** They fail on today's code. Prove two by mutation.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
