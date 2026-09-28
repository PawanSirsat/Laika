---
id: LAI-619
title: The task panel shows its sprint, and can change it
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
started: 2026-09-23T08:32:21Z
finished: 2026-09-23T08:32:21Z
status: done
reviewed: 2026-09-28T17:49:35Z
---

## Goal

**Owner, with a screenshot of the task panel:** *"i want option here to change
the sprint in task properly, also show the sprint in that."*

The rail showed Assignee, Status, Priority, Space, Created via and Watchers —
**not the sprint**, even though `Task.sprint_id` has existed since LAI-121.
Moving a task between sprints meant leaving the task and going to the Sprints
screen.

## Acceptance criteria

- [x] The rail shows the task's sprint by name.
- [x] It can be changed from there, to any sprint on the project.
- [x] **`No sprint` is reachable** — backlog work belongs to no sprint, and
      without it the only way *out* of one was the Sprints screen.
- [x] A Viewer sees it and cannot change it (§3.2: member+), asked through
      `canAssignToSprints` — the same helper the Sprints screen uses.
- [x] A refusal shows the **server's** reason, not an invented one.
- [x] Full gate, all three `EXIT 0`.

## Verified

Driven on a local instance, both paths — they are different calls and a move
never exercises the clear:

```
panel fields : Assignee | Status | Priority | Sprint | Space | Created via | Watchers
options      : No sprint | S1 · Foundations | S2 · The board | S3 · Jira parity | S4 …
move         : S1 -> S2      persisted = true
clear        : S2 -> (none)  persisted = true
error shown  : none
```

Gate: TEST 0, LINT 0, FMT 0 — 2040 server, 1065 web.

## Notes / context

**One request to move, measured rather than assumed.** `POST
/sprints/:id/tasks` on a task already in another sprint **reassigns** it and
returns the updated task — it does not refuse and needs no prior delete. Only
clearing needs `removeTaskFromSprint`, because there is no sprint to post to.
Both are asserted, so a later "simplification" cannot collapse them into one.

**A neighbouring count assertion was replaced, not bumped.**
`task-panel.test.ts` asserted the rail had exactly **6** `.meta-row`s and
failed with `expected 6, actual 7` — a true failure reporting the wrong thing,
since nothing had been lost. It now asserts the fields **by name**, so a future
failure says *which* field went missing instead of leaving the reader to
diff two numbers. That is this repo's own rule about counts, applied where it
bit.

**The labels are upper-cased by CSS**, so the check is case-insensitive:
`text-transform` is the theme's business and pinning it here would make a
restyle fail a test about fields.

## Review — 2026-09-28T17:49:35Z (CHIEF)

**Accepted.** Merged as part of `shell` up to `df23d67`.

**Verified on a private instance**, each step read back from the API rather
than from the screen:

```
panel selects : … | No sprint, S1 Foundations, S2 The board
-> S1         : persisted, sprint_id = S1
-> S2         : persisted, sprint_id = S2   (one POST, no prior delete)
-> No sprint  : persisted, sprint_id = null
error shown   : none
```

**Mutation:** making the control ignore `maySetSprint` turns
`sprint-control.test.ts` **red** on its named assertion.

**Not browser-verified: the Viewer case.** No Viewer account was created. The
gate is `canAssignToSprints`, the Sprints screen's helper. It is pinned by a
source scan and by the mutation above, which proves the scan catches a changed
gate but **not that a Viewer sees a disabled control.** These tests are source
scans throughout; they pin the text, not the behaviour.

**Process, recorded:** as with LAI-617, the file was created straight into
`review/` with `started` = `finished`, and **there is no SHELL log entry for
this task.**
