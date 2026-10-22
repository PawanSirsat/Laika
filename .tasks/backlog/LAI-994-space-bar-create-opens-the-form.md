---
id: LAI-994
title: 'The space bar''s Create goes to the board with ?new=task, but nothing reads it, so the create form never opens'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-992]
discovered-from: LAI-992
status: backlog
---

## Acceptance criteria

- [ ] Arriving at the board (or list) with `new=task` opens the create form in
      the first open column (or the list's create row) for holders of
      `task.create`, then clears the parameter; non-holders see nothing.
- [ ] Browser test from the space bar's Create. Gate exit 0.
