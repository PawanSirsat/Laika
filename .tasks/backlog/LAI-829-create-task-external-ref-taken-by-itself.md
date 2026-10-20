---
id: LAI-829
title: 'create_task with external_ref answered "already the outside id of LAIKA-617" for the card it had just created'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-817
status: backlog
---

## Goal

`create_task` with an `external_ref` either creates the task and answers
success, or refuses with nothing created. CLAUDE.md's Laika step 3 tells every
session to do exactly this call, so a create that errors after filing teaches
the caller to retry, and makes duplicates.

## Found (LAI-817 builder, 2026-10-20, observed once, not reproduced)

- `get_task_context LAI-817` and `start_working LAI-817` both answered
  `not_found: No task with id "LAI-817"`.
- `create_task` in `laika` with `external_ref: LAI-817` then answered
  `unprocessable: LAI-817 is already the outside id of LAIKA-617 in this
  project` (`field: external_ref`, `reason: taken`).
- `start_working LAIKA-617` succeeded: the card carries `external_ref: LAI-817`,
  `created_via: mcp`, `created_by_client: omnigent on macOS`, and `created_at`
  1792501181781, four seconds before the claim at 1792501185835. No other
  session was filing LAI-817 then.
- So the call most likely **created the card and then refused**: either a
  uniqueness check that runs after the insert and finds the new row, or the
  transport sending the call twice. LAI-781 is the same shape for `sprint`.

## Acceptance criteria

- [ ] A test calls `create_task` with a fresh `external_ref` and gets success
      and exactly one task; it fails first on today's code if the cause is
      server-side. If it is not, say so and close this as a transport issue.
- [ ] A taken `external_ref` refuses with nothing created.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
