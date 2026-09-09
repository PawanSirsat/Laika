---
id: LAI-233
title: The board draws dependencies and offers no way to add or remove one
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-460
status: backlog
---

## Goal

`POST /api/v1/tasks/:id/dependencies` and `DELETE .../dependencies/:depId` are
served, tested, and **called by nothing in the SPA** (LAI-460).

The board *reads* dependencies everywhere — `blocked_by` drives the blocked card,
the red timeline bar (LAI-436), `blockedState`, and the `BLOCKED` count on the
sprint strip. **A person can see that a task is blocked and cannot say what by,
or unblock it**, without an agent or curl.

## Acceptance criteria

- [ ] A dependency can be added from the task detail panel — the design's
      `+ Link task` — and removed.
- [ ] The picker cannot offer a task that would make a cycle. §4.6 refuses one;
      the UI must not present the option and then surface a `409`.
- [ ] It shows the blocker's **display key and title**, never a ULID (§7).
- [ ] `LAI-460`'s exemptions lose `api/v1/tasks/*/dependencies` and
      `.../dependencies/*`; that check goes red until they do.
- [ ] Both themes. Full gate `EXIT 0`.

## Notes

The endpoints take `blocked_by_task_id` — **not** `depends_on_task_id`, which is
what a seed script of mine guessed and got a `422` for.
