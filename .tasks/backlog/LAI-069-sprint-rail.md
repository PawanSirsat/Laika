---
id: LAI-069
title: Sprint rail and active-sprint banner on the board
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-068]
discovered-from:
status: backlog
---

## Goal

The prototype's board opens with a sprint rail (`All sprints`, S1…S4 with
progress) and, beneath it, a banner for the active sprint: completion ring,
`ACTIVE` badge, name, date range, goal, and the counts DONE / BLOCKED / WIP /
DAYS LEFT.

## Acceptance criteria

- [ ] A rail of the project's sprints; selecting one filters the board to it,
      and `All sprints` clears the filter.
- [ ] The selection lives in the URL, as the project choice does.
- [ ] The active sprint's banner shows name, range, goal, and progress — every
      number derived from real tasks.
- [ ] **DONE**, **BLOCKED** and **DAYS LEFT** are derivable and required:
      done/total from task statuses, blocked from `ready === false`, days left
      from `ends_on` (inclusive — the last day counts).
- [ ] **WIP is a count, not a limit** — show in-progress tasks, with no
      denominator (see LAI-067).
- [ ] No active sprint is a normal state and must render as one.
- [ ] Both themes.

## Notes / context

Depends on LAI-068 so the sprint fetching and name resolution exist once, in one
place, rather than twice.
