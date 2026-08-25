---
id: LAI-214
title: The events stream hands out `ready` during shutdown drain
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-070
status: backlog
started:
finished:
---

## Goal

While wiring the board to the SSE stream I stopped my dev instance with
`SIGTERM` and watched the frames. The shutdown itself behaves as designed —
`onStopping()` ends the open streams, every client gets
`closing {"reason":"server_shutdown"}`, and `server.close()` stops the listener.

Then, **three seconds into the ten-second grace window, the server accepted two
brand-new `GET /api/v1/events` requests and answered `200`** with a fresh
`ready` frame:

```
00:41:44.550  shutdown.start        grace_ms=10000
00:41:47.563  GET /api/v1/events    200   <-- 3.0s after shutdown began
00:41:47.565  GET /api/v1/events    200
00:41:54.553  shutdown.forced       grace_ms=10000
```

`server.close()` stops accepting new **TCP connections**, but the browser
already had idle HTTP keep-alive connections to the origin, and it reused one to
reconnect. `closeIdleConnections()` runs **once, synchronously**, immediately
after `close()` — a connection that becomes idle a moment later is never reaped,
so it stays available for exactly this.

The effect on a client: it is told the stream is ready by a process that is
about to be force-killed. The connection then survives until
`closeAllConnections()` at the end of the grace window, so for up to `grace_ms`
the browser holds a live-looking stream that will never deliver a frame.

## Why this is small, and why it is still worth fixing

The client recovers correctly — I verified it. After the forced exit it retries
every 3s on the server's own `retry:` hint and the pill reads `RECONNECTING`,
with no error state, for as long as the instance is down. **Nothing is broken
for a user beyond a few seconds of a stale-but-plausible pill during a deploy.**

It is worth fixing because the server is making a promise it has already decided
not to keep, and because the same reused-keep-alive path means *any* endpoint can
be served during the drain — the events stream is just where it is visible.

## Notes

- Not the same as **LAI-057**, which guards the `onStopping` → `closeAll()`
  wiring. That defect is "streams are never closed"; this one is "streams are
  opened after we decided to stop". LAI-057 fixing its wiring does not fix this,
  and this was observed on an instance where that wiring was working.
- The fix is likely a "stopping" flag consulted by the events route (and
  probably by a middleware) so a request arriving after `shutdown.start` is
  refused — `503` with `Connection: close`, or a `closing` frame instead of a
  `ready` — rather than trying to win a race with `closeIdleConnections()`.
- Whatever the shape, prove it by driving a real `SIGTERM` and asserting no
  `ready` is issued after `shutdown.start`. Both halves of this are already
  individually tested and both were green while this happened.

## Acceptance criteria

- [ ] After `shutdown.start`, a new `GET /api/v1/events` on a reused keep-alive
      connection does not receive a `ready` frame.
- [ ] A test drives an actual shutdown and fails if a `ready` is issued during
      the grace window. Prove it can fail by removing the guard.
- [ ] Clients already connected still get `closing` before the socket ends —
      the existing behaviour must not regress.
- [ ] Ordinary requests during the drain get a definite answer, not a hang: a
      refusal is fine, a socket held to `grace_ms` is not.
