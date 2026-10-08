---
id: LAI-719
title: 'List: the bulk-action bar floats over the pinned Create row while rows are selected'
area: web
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-717
status: done
started: 2026-10-08T11:09:37Z
finished: 2026-10-08T11:09:37Z
---

## Goal

LAI-717 pinned the List's "+ Create task" row to the foot of the table card.
The bulk-action bar (`.list-bulk` in `list.css`) is absolutely positioned
`2.75rem` above the pane's bottom, which is now exactly where the pinned
Create row sits, so while any row is selected the bar covers it. It is a
floating bar during a selection, so this may be acceptable; it was not
decided in LAI-717 because the owner's request did not cover selection.

## Acceptance criteria

- [x] A decision, recorded in the task: the bar may cover Create while
      selecting, or it sits above the Create row.
- [x] If it moves: with rows selected, the bar and the Create row do not
      overlap, measured in a browser test, at 1440×900 and at 900px wide.

## Notes / context

- `ListView.tsx` renders `BulkBar` inside `.list-pane`; the Create row is
  `.list-create`, sticky at the bottom of `.list-scroll`.

## Closed — fixed in LAI-717 (round 1)

The review of LAI-717 called this a regression of that task rather than a
separate decision, and it is: the Create row only sits under the bulk bar
because LAI-717 pinned it there. Fixed in LAI-717: the bulk bar now sits in a
positioned `.list-card` and floats `--list-create-h` plus a gap above the
card's foot, so it clears the Create row on a short list and at the end of a
long scroll. `list-create-row.test.ts` asserts both cases; both fail on the
code before the fix.

The decision this file asked for: **the bar sits above the Create row**, never
over it.

