---
id: LAI-719
title: 'List: the bulk-action bar floats over the pinned Create row while rows are selected'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-717
status: backlog
---

## Goal

LAI-717 pinned the List's "+ Create task" row to the foot of the table card.
The bulk-action bar (`.list-bulk` in `list.css`) is absolutely positioned
`2.75rem` above the pane's bottom, which is now exactly where the pinned
Create row sits, so while any row is selected the bar covers it. It is a
floating bar during a selection, so this may be acceptable; it was not
decided in LAI-717 because the owner's request did not cover selection.

## Acceptance criteria

- [ ] A decision, recorded in the task: the bar may cover Create while
      selecting, or it sits above the Create row.
- [ ] If it moves: with rows selected, the bar and the Create row do not
      overlap, measured in a browser test, at 1440×900 and at 900px wide.

## Notes / context

- `ListView.tsx` renders `BulkBar` inside `.list-pane`; the Create row is
  `.list-create`, sticky at the bottom of `.list-scroll`.
