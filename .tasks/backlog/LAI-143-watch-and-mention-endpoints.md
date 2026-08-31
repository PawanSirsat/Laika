---
id: LAI-143
title: Endpoints for watching a task and reading your mentions
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-094]
discovered-from: LAI-094
status: backlog
---

## Goal

LAI-094 built the watch/mention substrate as services and left it there
deliberately: its acceptance criteria ask for the relationship and the parse,
not for transport, and the task calls itself "the notification substrate". So
today nothing outside `server/src/services/` can reach any of it — the design's
**Watch** button has no endpoint to call.

This is that transport, plus the SPEC §6 rows it needs.

## Why it was not folded into LAI-094

Two reasons, and they point the same way.

**The criteria were the contract.** CHIEF and CORE agreed on 2026-09-01 that a
task in flight is built to the criteria written when it was claimed. Adding
endpoints because they were obviously wanted is the same widening-in-flight the
agreement rules out, just in the builder's favour instead of the reviewer's.

**§6 is CHIEF's.** Endpoints that no spec section lists are endpoints nobody
reviewed. The rows have to exist before the routes do, and they are not CORE's
to write.

## What is needed

**From CHIEF, first:** §6 rows for the endpoints below, and a decision on the
two shapes flagged in Notes.

**Then, in `server/src/http/routes/`:**

- `PUT /api/v1/tasks/:id/watch` and `DELETE /api/v1/tasks/:id/watch` —
  `watchTask` / `unwatchTask`. Both are `project.read`.
- `GET /api/v1/tasks/:id/watchers` — `watchersOfTask`.
- `GET /api/v1/me/watching` — `tasksWatchedBy`, own-only, which is the whole of
  why it hangs off `/me` rather than `/users/:id`.

`TaskView` probably gains the caller's own `watch_state` too, so a task detail
does not need a second request to know whether the button is lit — but that is a
serialisation change and belongs in a §6.4 row, not improvised here.

## Acceptance criteria

- [ ] SPEC §6 lists each endpoint before it exists.
- [ ] Each route calls `can()` — the services already do, and the route must not
      be the layer that assumes so.
- [ ] `GET /me/watching` refuses to report anybody else's watches, and a test
      says so rather than relying on the service's guard.
- [ ] A read-only token can watch and unwatch, or cannot, and the answer is
      written down — see Notes.

## Notes / context

**Two shapes need deciding, and neither is a service's call.**

1. **Is watching a read or a write?** `watchTask` asks `can()` for
   `project.read`, because you may watch what you may read and watching grants
   nothing. But it writes a row, so a **read-only token** currently *can* watch.
   That may be right — a subscription is about the holder, not the project — or
   it may be exactly the kind of write a read-only credential should not make.
   §9.1 decides, not this task.

2. **Does `GET /users` tell a mention picker who is mentionable?** It is
   org-wide; a mention only resolves for somebody who passes `project.read` on
   that task's project (§4.19). A picker built on the org-wide list will offer
   names that silently resolve to nobody, which reads as a bug in the mention
   feature. Either the picker filters or an endpoint does.

Unread counts and a notification centre remain out of scope — they were out of
LAI-094's scope too, and they are a read-state model plus a screen.
