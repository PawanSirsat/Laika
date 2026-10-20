---
id: LAI-840
title: 'The task panel has no way to add acceptance criteria to a task that has none: the section is drawn only when set'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-827
status: backlog
---

## Goal

Somebody who may edit a task can write its acceptance criteria from the panel,
as Jira's issue view lets them fill any field in place.

LAI-827 made acceptance editable in place — but only where it already exists.
SPEC §11.4.2.1 lays the panel out with *"acceptance when set"*, so a task with
no `acceptance_md` draws no section, and there is nothing to click. Today the
only ways to add it are the API, MCP, or a new task.

## Acceptance criteria

- [ ] For a reader who may edit, a task with no acceptance shows a quiet
      *Add acceptance criteria* line where the section would be, which opens
      the same editor LAI-827 gives the description; a Viewer sees nothing.
- [ ] Saving sends `acceptance_md` only; an untouched open sends nothing.
- [ ] SPEC §11.4.2.1's *"acceptance when set"* is amended to say so (CHIEF's
      half — a named edit for this task, D-033).
- [ ] Browser test: the line opens the editor and a save PATCHes the field;
      a Viewer has no line.

## Notes / context

- `DocumentField` already handles an empty value (it shows its placeholder),
  so the UI half is mostly removing the `acceptance_md !== ''` condition for
  editors in `TaskDetailPanel.tsx`.
- A product decision first: whether an empty Acceptance section belongs on
  every task for editors. Hence CHIEF's SPEC line before the code.
