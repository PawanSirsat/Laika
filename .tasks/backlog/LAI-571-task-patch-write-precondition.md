---
id: LAI-571
title: 'PATCH /tasks/:id takes a precondition (If-Match or expected_updated_at), so a late write cannot overwrite a newer one'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-538
status: backlog
---

Filed by SHELL (Belka, dispatched by CHIEF) from the Codex round-5 review of
PR #106. **File only** — CORE's area; nothing here was implemented.

## Why

`updateTask` (`server/src/services/tasks.ts`, `const now = input.now ??
Date.now()`) stamps `updated_at` with the wall clock and applies a `PATCH`
unconditionally. Neither is a revision, so a client cannot order its writes
against the server's state:

- **Two writes in one millisecond share an `updated_at`.** LAI-538's drawer
  works around it with a client-side read order (`server/web/src/api/
  read-order.ts`), but that only tells reads apart, not writes.
- **An aborted request is not a cancelled write.** LAI-538 gives an agent
  selection a 30 s deadline, aborts the request, reads the task back and then
  lets the next selection go. If the server still executes the aborted `PATCH`
  *after* that read-back, it overwrites the later selection — and nothing on
  the client can prevent it. The read-back is not a write fence.

Only a server-enforced precondition makes the order a guarantee: the client
says which version it last saw, and the server refuses a write against any
other.

## Scope

- `PATCH /tasks/:id` accepts a precondition — `If-Match: <revision>` (and an
  `ETag` on every `TaskView` response), or a body field such as
  `expected_updated_at`. Which one, and whether `updated_at` stays the token or
  a monotonic `revision` column is added (two writes in one millisecond argue
  for the column), is CORE's design call.
- A mismatch answers `409` (`conflict`, §6.3) with the current task in
  `details`, so a client can show the truth without a second read.
- Absent precondition keeps today's behaviour, so every existing caller
  (web, MCP, CLI) is unaffected until it opts in.
- The MCP `update_task` tool may take the same precondition (decide with
  SHELL; the plugin and the SPA are SHELL's half).

## Acceptance criteria

- [ ] A `PATCH` with a stale precondition is refused `409` and changes
      nothing (asserted on the row and the activity log).
- [ ] A `PATCH` with a current precondition succeeds and returns the new
      precondition value.
- [ ] Two writes in one millisecond with the same precondition: exactly one
      succeeds.
- [ ] A `PATCH` with no precondition behaves exactly as today (existing
      route tests unchanged).
- [ ] SPEC §6.4 names the precondition (CHIEF's half, §4.4 if it is a new
      field the client mirrors).
- [ ] Repo-root gate exits 0.

## Follow-on (SHELL, not this task)

`server/web` sends the precondition on agent selection (`selectTaskAgent`), so
a write aborted at the deadline can no longer land after a newer one.
