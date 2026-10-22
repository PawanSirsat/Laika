---
id: LAI-996
title: 'Capacity: the three activity figures come back without the bar chart'
area: web
assignee: chief
priority: p1
depends-on: [LAI-992]
discovered-from: LAI-992
status: done
accepted: 2026-10-22T19:35:02Z
finished: 2026-10-22T19:34:52Z
started: 2026-10-22T19:27:26Z
---

## Why

LAI-992 took the whole *Activity · 14 days* block off the card on *"also
remove this activity thing"*. The owner meant the bar chart: *"why you
remove the by hand, by agent and bookkeeping? … bring back the three figures
without the bar chart."* So the three figures return — on the card and as
the List view's column — and the sparkline stays gone.

## Acceptance criteria

- [x] For an owner or admin, every card draws *Activity · 14 days · total*
      with three figures, *by hand · by agents · bookkeeping*, each with its
      rule on hover; no sparkline. A member's card has no such block (the
      server sends them no split).
- [x] The List view has the *Hand · Agents · Bookkeeping* column again for
      an owner or admin, each cell with its rule on hover; not for a member.
- [x] No task is read, nothing else LAI-992 removed returns.
- [x] SPEC §11.4.2.1 says so.
- [x] Browser tests: the owner test asserts the three figures and no
      sparkline; the LAI-991 tests carry the block's label and the column.
- [x] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Done by CHIEF on the owner's direct instruction, in worktree
`Laika-capacity` on branch `LAI-996-capacity-activity-figures`.

## Review (CHIEF, 2026-10-23)

Built and reviewed by the same session on the owner's instruction:

- Three figures, no sparkline: the owner test asserts `.cap-figs` reads
  *21 by hand 40 by agents 18 bookkeeping* and `.cap-spark` is absent; the
  member test asserts no `.cap-figs`.
- The list column: heads carry *hand · agents · bookkeeping* for an owner and
  not for a member; Pawan's cells carry *21 40 18*, Cal's *0 0 0*.
- Hover: the three figures' titles begin with their rules.
- No task read: LAI-992's *no task is read* test still green.
- Root gate on the branch: cli 604 / web 3034 / server 3629, `pnpm test` 0,
  `pnpm lint` 0, `pnpm format` 0.
