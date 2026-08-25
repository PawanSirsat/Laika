---
id: LAI-224
title: A forbidden event stream reports the instance as unreachable
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-081
status: backlog
started:
finished:
---

## Goal

**A defect in LAI-078, which I wrote.** Found while setting up a Viewer to test
something else.

Open a board you do not have access to. The board itself is correct — it says
*"You do not have access to this board. This needs at least the member role on
this project."* Underneath it, the connection banner says:

> **Can't reach localhost:3370**
> What is already on screen stays readable. Live updates resume when the stream
> reconnects.
> `attempt 1`

The instance is perfectly reachable. Measured:

```
GET /api/v1/events?project=laika-core
403 {"error":{"code":"forbidden","message":"You do not have access to that
     project","details":{"action":"project.read"}}}
```

So the reader is told the server is down, beside a message correctly telling
them it is a permission problem. **The two states contradict each other on one
screen**, and the more alarming one is the wrong one.

It also **retries for ever**, roughly every three seconds, against an endpoint
that will never succeed while the permission does not change.

## Why it happened

`EventSource` reports every failure as `onerror` with no status attached — a
refused connection and a `403` are indistinguishable *from the EventSource
alone*. LAI-078 mapped `onerror` to "dropped", which is right for a network
drop and wrong for a refusal.

## Acceptance criteria

- [ ] A `403` on the stream does not render as an unreachable instance.
- [ ] It stops retrying. A permission does not change because you asked four
      hundred times, and the retry loop is visible in the server log.
- [ ] A genuine network drop still shows the banner and still retries —
      LAI-078's behaviour must not regress. Verify both, do not assume.
- [ ] A test covers the two cases separately and fails if they collapse into
      one, the way `isCredentialRejection` guards `401` against `429` (LAI-220).

## Notes

- The status is not available on the `EventSource` error, so it has to come from
  somewhere else. Two candidates, and the second is probably right:
  - a pre-flight `fetch` of the same URL to learn the status, then open the
    stream — one extra request per connection.
  - the shell already knows: `/tasks` and `/projects/:slug` return `403` for the
    same project, and the board renders permission-denied because of it. Passing
    that fact to the stream costs nothing and needs no extra request.
- This is the same shape as **LAI-220**: two different failures collapsed into
  one state, where only one of them is the reader's to act on.
