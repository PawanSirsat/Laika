---
id: LAI-300
title: 'My day Timeline: a design for four or more blocks at once, and for blocks too narrow to point at'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-860
status: backlog
---

## Goal

LAI-860 made the YOU row's rule hold at any depth: blocks at the same time
take a row each, and a label, a count badge or an edge handle is drawn only
where it fits and clears its neighbours. **Past a certain depth and below a
certain width that rule leaves a block with nothing but its fill.** It can
still be told apart and clicked, and its details are in the inspector, but it
cannot be read on the lane. This task is the design decision for those two
cases, and then building it.

## Where LAI-860's rule stops (measured in Chrome, 2026-10-21)

**Down — rows by depth.** The row is 4.25rem (68px); a stack's rows share
68 − 10px, 2px apart, so each is `60 / n − 2` px:

| at once | row | what is drawn (hour-long blocks at 2×, 1440px) |
| --- | --- | --- |
| 1 | 58px | label, figures, badge, handles; not the card title |
| 2 | 28px | each label; the top row's badge; handles |
| 3 | 18px | each label (one 16px line); the top row's badge; no handles (under 20px) |
| 4 | 13px | the top row's badge; no labels (a 16px line does not fit) |
| 5 | 10px | the top row's badge, which ends just above row 2 |
| 6 | 8px | the blocks only: the top badge would reach 1px into row 2 |
| 7, 8 | 6.6, 5.5px | the blocks only |

Measured with a probe on stretches of one to eight at once. Of these the
browser test (`my-day-timeline-zoom.test.ts`) asserts the 3-at-once label at
1× and 2×, the 5-at-once top badge at 2×, and that eight at once draw no
label, badge or handle. A handle that is not drawn still takes Tab, ← and →.

**Across — too narrow to point at.** At Fit on a 390px window five minutes is
about 1.7px. Chrome hit-tests up to about 0.9px off the boxes it reports at
that width (measured on a block with nothing near it, with and without the
clip), so two five-minute blocks back to back cannot be told apart by a
pointer at all. LAI-860's test skips its "on top at its own centre" check for
a centre within 1px of a neighbour's box, and only there.

**The card title.** On a block with one row to itself, the key, the title
and the figures are three lines, and the body has room for two at the lane's
height, so the title is not drawn. On master before LAI-860 it was drawn and
clipped.

## Options (the owner's call; D-020: CHIEF and builders do not decide design)

- A cap: draw up to N rows and a `+N` marker for the rest, which opens a list.
- A taller YOU row when a day has a deep stack.
- Real lanes: one per card or project, so parallel work is side by side by
  design rather than squeezed into one row.
- A minimum drawn width at Fit (and on a phone), with blocks that would then
  overlap merged into one marker.

## Acceptance criteria

- [ ] The owner picks a direction (or a combination) for both cases, recorded
      here before any code.
- [ ] From four at once, every block shows at least which card it is on, or a
      marker that leads to the blocks it stands for.
- [ ] At Fit on a 390px window, every block can be selected with a pointer,
      or is reachable through a marker that stands for it.
- [ ] The card title is shown wherever there is room for it, or the design
      says where it lives instead.
- [ ] `my-day-timeline-zoom.test.ts` keeps passing, with its depth and width
      exemptions narrowed to what the new design leaves.
- [ ] No design token or colour changes without the owner (D-020).
- [ ] The repo-root gate exits 0: `pnpm test`, `pnpm lint`, `pnpm format`,
      each exit code captured on its own line.

## Notes

- Same files as LAI-860 and LAI-834 (`Timeline.tsx`, `timeline-derive.ts`,
  `my-day.css`). LAI-834's SIGNALS lane sits above the row and has the same
  across problem at Fit (its notes in LAI-860's review section).
- Filed by Strelka from Strelka's id block (LAI-300–399, D-097).
