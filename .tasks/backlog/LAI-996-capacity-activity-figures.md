---
id: LAI-996
title: 'Capacity: the three activity figures come back without the bar chart'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-992]
discovered-from: LAI-992
status: backlog
---

## Why

LAI-992 took the whole *Activity · 14 days* block off the card on *"also
remove this activity thing"*. The owner meant the bar chart: *"why you
remove the by hand, by agent and bookkeeping? … bring back the three figures
without the bar chart."* So the three figures return — on the card and as
the List view's column — and the sparkline stays gone.

## Acceptance criteria

- [ ] For an owner or admin, every card draws *Activity · 14 days · total*
      with three figures, *by hand · by agents · bookkeeping*, each with its
      rule on hover; no sparkline. A member's card has no such block (the
      server sends them no split).
- [ ] The List view has the *Hand · Agents · Bookkeeping* column again for
      an owner or admin, each cell with its rule on hover; not for a member.
- [ ] No task is read, nothing else LAI-992 removed returns.
- [ ] SPEC §11.4.2.1 says so.
- [ ] Browser tests: the owner test asserts the three figures and no
      sparkline; the LAI-991 tests carry the block's label and the column.
- [ ] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Done by CHIEF on the owner's direct instruction, in worktree
`Laika-capacity` on branch `LAI-996-capacity-activity-figures`.
