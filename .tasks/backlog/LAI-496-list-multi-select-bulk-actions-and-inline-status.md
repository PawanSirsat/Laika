---
id: LAI-496
title: 'The List selects rows, acts on the selection, and changes status in place'
area: web
assignee: unclaimed
priority: p1
depends-on: []
status: backlog
---

## Goal

The owner's two screenshots of a Jira list: a checkbox on every row and in
the header, a status pill on each row that opens a menu and changes the
status where it stands, and — once anything is selected — a floating bar
that says how many are selected, offers *Select all* over the whole filtered
list, and applies a change (status, priority, assignee, sprint, cancel) to
every selected task.

## Acceptance criteria

- [ ] A pure `list-select` module (mirrored test) gives `toggleOne`,
      `togglePage`, `pageState` (`none` / `some` / `all`), `selectAll` and
      `effectiveSelection`, where the effective selection is the stored set
      pruned to the rows currently on screen, so a filter change cannot act
      on a task the reader can no longer see.
- [ ] A pure `list-bulk` module (mirrored test) gives `statusTargets(from)`,
      asserted **equal to the server's own `transitionsFrom(from, 'human')`
      for every status** — never a hand-copied table — and `applyToEach`,
      which runs one request per task in order, keeps going past a refusal,
      and returns which ids succeeded and which failed with the server's
      message. The test has a refusal in the middle of the list.
- [ ] Every row has a checkbox in a first column; the header checkbox selects
      or clears the page and shows indeterminate for a partial page. Clicking
      a checkbox never opens the drawer. A selected row is tinted.
- [ ] The status cell is a button styled as the pill with a chevron. It opens
      a menu of the legal targets, labelled by the board's column names
      (LAI-490); choosing one calls the same `move` the drag uses, so a
      refusal surfaces in the board's existing error strip and nothing moves
      until the server answers. A row whose move is in flight says so.
- [ ] With one or more rows selected, a floating bar at the foot of the List
      shows `n selected`, *Select all N* when the selection is short of the
      whole filtered list (and is absent once it is), then **Status**,
      **Priority**, **Assignee**, **Sprint** (only with `maySetSprint`),
      **Cancel tasks** (with an inline confirm) and a clear button.
- [ ] A bulk action runs through `applyToEach`, shows progress while it runs,
      then reports `n updated` and lists every refusal by key with the
      server's message; the board reloads after it. The selection survives a
      reload because it lives in `BoardScreen`, not in the view that reload
      unmounts (the LAI-485 lesson).
- [ ] A viewer gets no checkboxes, no bar and a plain pill.
- [ ] Browser tests: a row checkbox and the header checkbox; *Select all*
      reaching rows on page two; a bulk status change POSTs
      `/tasks/:id/status` once per selected task and reports one refusal by
      key; the inline pill POSTs for one task; a viewer sees no checkbox.
- [ ] Both themes; the repo-root gate exits 0 on all three.

## Notes / context

Owner-directed, 2026-10-06, from two screenshots of a Jira list. SPEC
§11.4.1 says bulk edit is "explicitly not in v1" — this task retires that
sentence; the SPEC edit and the decision entry are CHIEF's half. There is no
`DELETE /tasks/:id` (§6.4), so *Delete* in the screenshot is **Cancel** here:
`cancelled` is the status the board hides, and the server refuses it from
`done`, which the report must show rather than hide. One request per task:
§7.2's "tools never bulk-mutate" is about MCP tools, and the sprint endpoint's
own all-or-nothing POST is called with one id at a time so a refusal names
the task. Files: `routes/screens/list/` (`ListView.tsx`, `list.css`, two
new pure modules, a menu and a bar component), `BoardScreen.tsx` (selection
state, four props).
