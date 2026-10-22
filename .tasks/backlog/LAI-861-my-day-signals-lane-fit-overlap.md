---
id: LAI-861
title: "My day's SIGNALS lane at Fit: dots in neighbouring five-minute slots draw over each other"
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-834]
discovered-from: LAI-860
status: backlog
---

## Goal

Once LAI-834's SIGNALS lane is on `master`, its prompt dots and commit ticks
read cleanly at Fit, as LAI-860 made the YOU row read at every zoom: no mark
is drawn over the mark of the next five minutes.

## Acceptance criteria

- [ ] At Fit, at 1440 px and at 390 px, no prompt dot overlaps the dot of a
      neighbouring five-minute slot, and no commit tick overlaps a
      neighbour's tick. Marks that do not fit are merged into one mark that
      says what it holds, or thinned, never drawn on top of each other.
- [ ] 1× and 2× are unchanged; they have room today (see Notes).
- [ ] A browser test measures the marks' bounding boxes at Fit, fails on
      LAI-834's code, and passes after. It asserts boxes, not a count.
- [ ] No design token or colour changes (D-020).
- [ ] The repo-root gate exits 0: `pnpm test`, `pnpm lint`, `pnpm format`.

## Notes / context

Found while fitting LAI-860 to LAI-834 (branch `LAI-834-signals-lane`,
`my-day.css`): a prompt dot is `0.4375rem` (7 px) wide, centred on its slot,
and a commit tick is 2 px. A five-minute slot measures 9.2 px at 1× and
18.3 px at 2×, so those zooms are clear; at Fit it is 3.8 px at 1440 px, so
neighbouring dots overlap by about 3 px, and 1.7 px at 390 px, so ticks touch
too. The slot widths are LAI-860's measurements of five-minute blocks on a
seeded day. A dot and a tick in the **same** slot share a centre by design;
this is about neighbours only.

Blocked on LAI-834 landing: the lane does not exist on `master` yet. Work in
`server/web/src/routes/screens/my-day/` only.
