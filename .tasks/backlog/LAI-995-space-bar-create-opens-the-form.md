---
id: LAI-995
title: 'The space bar''s Create goes to the board with ?new=task, but nothing reads it, so the create form never opens'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-178]
discovered-from: LAI-178
status: backlog
---

## Acceptance criteria

- [ ] Arriving at the board (or list) with `new=task` opens the create form in
      the first open column (or the list's create row) for holders of
      `task.create`, then clears the parameter; non-holders see nothing.
- [ ] Browser test from the space bar's Create. Gate exit 0.

## Renumbered

Filed as LAI-994 in d484ed3d one minute after LAI-993's builder filed its own
LAI-994 (bae404dd, SPEC §4.58); the earlier filing wins. That commit's
`[ops]` subject names LAI-994 but belongs to this task.
