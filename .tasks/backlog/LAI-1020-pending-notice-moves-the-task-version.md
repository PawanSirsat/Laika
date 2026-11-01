---
id: LAI-1020
title: "A task's version moves when checkpoint.pending_notice turns on with the clock, so an If-Match write 409s with nothing written"
area: core
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1016
status: backlog
---

## Why

`taskVersion` (`server/src/services/tasks.ts`) hashes the task view a read
returns, and leaves out only what moves without a write: the live claim's
pulse (`CLAIM_PULSE`, LAI-568) and, since LAI-1016's review,
`handoff.no_recent_save`. `handoff.checkpoint.pending_notice` is left in.
It turns from `false` to `true` when the server's clock passes §9.1.1's
pending notice (10 minutes after a `pending` save's newest ref), with no write
to the task.

So a client that reads a task while its save is pending, and sends a guarded
`PATCH` after the notice turns on, gets `409 conflict` with an unchanged task.
Found reviewing LAI-1016 (PR #175), which fixed the same shape for
`no_recent_save` and left this one alone as out of its scope.

## Acceptance criteria

- [ ] `taskVersion` leaves `handoff.checkpoint.pending_notice` out of the
      hash, the same way it leaves out `no_recent_save`; the checkpoint itself
      (its verification, time and `pending_since`) stays in, so a notice from
      GitHub is still a new version.
- [ ] A test with an injected clock reads a task with a `pending` save just
      before the notice, reads it again just after with no write between, and
      asserts the same version, and that a `PATCH` with the first `If-Match`
      succeeds.
- [ ] The test goes red when `pending_notice` is put back into the hash.

## Notes

No new dependencies. The comment above `taskVersion` names each field it
leaves out; add this one there.
