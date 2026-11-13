---
id: LAI-1178
title: 'Space Calendar: any month, an overdue lane, one-height days, sprint bands, filters and drag to reschedule'
area: shell
assignee: unclaimed
priority: p2
depends-on: []
status: backlog
---

## Goal

The owner, on 2026-11-13: *"this calendar is not that good, can improve the UI
UX"*. Their screenshots showed four problems:

- One old day held about 15 overdue chips, so the row grew past the screen.
- Chip titles were cut to 2–4 letters.
- "S9 / S10" was printed in every cell over a red sprint tint.
- There was no way to reach another month, and the toolbar's filters did
  nothing on this tab.

The owner chose the core cleanup, month navigation, an overdue lane and drag to
reschedule, and wanted the toolbar filters applied. No server change:
`PATCH /tasks/:id` already takes `due_on`.

## Acceptance criteria

- [ ] **Months:** ‹ Today › and ← → page the months. The month is in
      `?month=YYYY-MM` (absent means this month), and back/forward walk them.
- [ ] **Overdue:** open tasks due before today sit in an *Overdue* lane above
      the grid, oldest first, each with its date. The lane folds, and its
      count stays visible.
- [ ] **Day cells:** every day is one height. Three chips, or two plus
      "+N more", most urgent first; the date or "+N more" opens the whole day.
- [ ] **Chips:** a priority stripe, the key and the status name (in its kind's
      colour, LAI-739) on line one, and the title on line two. The legend
      names P1 and P2.
- [ ] **Sprints:** one band per sprint per week with its real name, the
      running one accented. No per-cell `S9`, no full-cell tint.
- [ ] **Filters:** the toolbar's priority, tag, assignee, ready and search
      apply, and the subtitle says *filtered*.
- [ ] **Drag:** dragging a chip, or an overdue one, to a day sends
      `PATCH /tasks/:id {due_on}` optimistically, with an Undo toast. The day's
      *Move to…* does the same from the keyboard. Both only with `task.write`.
- [ ] **Phone:** an agenda of the month's days that hold work, with nothing
      scrolling sideways. Both themes.
- [ ] **Tests:** `calendar-redesign` unit and browser tests and a
      `calendar-drag` mirror test; the existing calendar tests updated to the
      new wording and markup.
- [ ] **Named edit (D-033):** SPEC §11.4.2's Calendar row, stale since D-059
      (it said *none defined, no decision*).

## Notes / context

Plan: `.claude/plans` (owner-approved 2026-11-13).
