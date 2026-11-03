---
id: LAI-1120
title: 'Board card shows "n of m built" from the deliverables'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-1115, LAI-1117]
discovered-from: LAI-1117
status: backlog
---

## Goal

The card on the board could carry the same progress line the task detail
shows. `deliverables` is left out of the slim list on purpose (LAI-1115), so
this needs either a derived count on `TaskSummaryView` (server) or the field
on the summary.

## Acceptance criteria

- [ ] A decision on the summary shape, then the card field (toggleable with
      the others in `card-fields.ts`).

## Notes / context

Filed from the redesign plan; not needed for the detail.
