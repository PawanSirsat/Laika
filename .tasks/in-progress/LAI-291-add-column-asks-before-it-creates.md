---
id: LAI-291
title: 'The add-column tile creates a column without asking — it should ask'
area: web
assignee: shell
priority: p1
depends-on: [LAI-290]
discovered-from: LAI-290
started: 2026-09-19T17:32:10+05:30
status: in-progress
---

## Goal

**Asked for directly by the owner, with a reference screenshot.** Clicking the
`+` tile at the end of the board must open a **Create status** dialog — *Name*
(required), *Status category*, Cancel / Submit — instead of what it does today:

```ts
onAddColumn: () => {
  void columns.create(nextColumnName(columns.visible));
},
```

A column called `Column 5` appears and you rename it afterwards.

## Acceptance criteria

- [ ] The `+` tile opens a dialog. **Nothing is created until Submit.**
- [ ] **Name is required**, and Submit cannot be pressed without one — not a
      `422` after the fact.
- [ ] **Status category picks what the column holds.** Every status is offered,
      and one already held by another column **moves**, saying which column it
      leaves — the wording `ColumnDialog` already uses.
- [ ] *Nothing yet* creates an empty column, which is legal
      (`primary_status: null`) and a real thing to want mid-setup.
- [ ] Escape and the scrim close it; the name field takes focus on open.
- [ ] Both themes. Full gate — **all three `EXIT 0`**, repo root.

## Notes / context

**`POST /board-columns` takes only a name**, so the status is a second request
(`PUT .../statuses`). Ordered so a failure on the second leaves a real, empty,
visible column rather than nothing — the name the person typed is not thrown
away, and Column settings can finish the job.

**The gate on the tile is unchanged**: `mayConfigure` and a board that is not
still on fallback columns. A board that has never been backfilled has no columns
to add to.
