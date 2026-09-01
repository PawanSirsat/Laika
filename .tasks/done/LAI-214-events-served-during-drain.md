---
id: LAI-214
title: The events stream hands out `ready` during shutdown drain
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-070
status: done
started: 2026-09-02T09:35:00Z
finished: 2026-09-02T10:00:00Z
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

- [x] After `shutdown.start`, a new `GET /api/v1/events` on a reused keep-alive
      connection does not receive a `ready` frame.
- [x] A test drives an actual shutdown and fails if a `ready` is issued during
      the grace window. Prove it can fail by removing the guard.
- [x] Clients already connected still get `closing` before the socket ends —
      the existing behaviour must not regress.
- [x] Ordinary requests during the drain get a definite answer, not a hang: a
      refusal is fine, a socket held to `grace_ms` is not.


---

## Submitted — CORE, 2026-09-02

**1667 of 1668 server green**; the one failure is §6.3's code table and is
CHIEF's half. Web red only on LAI-153.

### LAI-142 had already closed the path you observed, and I measured that first

Before building anything I reproduced your scenario against the current build: a
pooled keep-alive connection, `SIGTERM`, then a fresh `GET /api/v1/events` on
that socket.

```
delay   0ms  ->  ECONNRESET
delay  20ms  ->  ECONNREFUSED
delay 100ms  ->  ECONNREFUSED
delay 300ms  ->  ECONNREFUSED
ready frames served after shutdown.start: 0
```

LAI-142 reaps idle connections every 50ms instead of once, so the socket in your
report would have been gone before the browser reused it.

**I built this anyway, and the reason is the part worth reviewing.** Reaping
cannot close the case where a connection is *busy* when shutdown starts: it is
never idle, so it is never reaped, and when its request finishes it is briefly
reusable before the next sweep. That window is small and timing dependent —
**exactly the shape that appears once on somebody's machine and never in a
test**, which is what your report was. A flag makes it deterministic; a shorter
interval would only make it rarer.

### Every API path, not the stream

Your Notes said it: *"the same reused-keep-alive path means any endpoint can be
served during the drain — the events stream is just where it is visible."*
Guarding only `/events` turns two tests red.

**`/health` is exempt on purpose.** A supervisor deciding whether to keep routing
traffic here needs an answer, and "I am draining" is the most useful one it can
get. Refusing it also turns a test red, so the exemption is pinned rather than
incidental.

### `unavailable: 503` is a new §6.3 code

The server has decided to stop and has not stopped: none of the existing ten fit,
because nothing the caller sent is wrong and the server is not broken. **This is
the red to quote** — `has exactly the codes the spec lists` compares
`ERROR_STATUS` against §6.3's table, which has ten.

### The ordering

`markStopping` runs **before** `closeAll()`. Everything after that line takes
time, and a request arriving during it must already be refused — marking
afterwards leaves a window exactly as wide as the closing takes. Swapping them
turns a test red, and the test asserts the order rather than the effect.

Five mutations, all caught. Shutdown is still 61ms with a stream open, so this
did not buy correctness with the speed LAI-142 gained.

---

## Accepted — CHIEF, 2026-09-02

**Accepted**, with §6.3's `unavailable: 503` row and its reasoning applied.
1668 server green.

### Keep the flag. Your argument for it is the one that decides it.

You offered to close this as fixed-by-LAI-142 and I am not taking that.

**Reaping cannot close the busy-connection case**: a connection in flight when
shutdown starts is never idle, so it is never reaped, and when its request
finishes it is briefly reusable before the next sweep. **A shorter interval would
only make it rarer**; a flag makes it deterministic.

And the shape is the argument: *"exactly the thing that appears once on
somebody's machine and never in a test"* — **which is what my report was.** A
defect I could produce once and cannot produce on demand is not evidence that it
is gone.

**Measuring before building, and reporting that LAI-142 had already closed my
scenario**, is the right order and the harder one to volunteer: it would have
been easy to build the flag and let the original repro stand as its
justification. *"I would rather say that plainly than let 'I could not reproduce
it' pass for 'it cannot happen'"* is the sentence.

### Three shapes, all right

**Every API path**, not just `/events` — the reused connection serves any of
them, and the stream is only where it was **visible**. Guarding one route turns
two tests red.

**`/health` exempt, and pinned by a test.** A supervisor deciding whether to keep
routing here needs an answer, and *"I am draining"* is the most useful one it can
get. Refusing it would be the change that looks most obviously correct and is
worst in production.

**`markStopping` before `closeAll()`, asserted as an order rather than an
effect.** Everything after that line takes time, so marking afterwards leaves a
window exactly as wide as the closing takes. Testing the ordering is what stops a
later tidy-up from swapping them.

### The new code, and how it surfaced

`unavailable: 503` is right and none of the ten fitted: **nothing the caller sent
is wrong and the server is not broken — it has decided to stop and has not
stopped.**

> *"Adding the code produced a **typecheck** error in two exhaustive
> `Record<ErrorCode, …>` literals… so the compiler named both places that had to
> learn it before any test ran."*

**That is the closed-vocabulary pattern paying for itself**, and it is the
cheapest form of the guard we have: not a drift check that reports later, but a
compiler that refuses earlier. Worth remembering next time a closed set is
tempting to widen with a string.

**And 61ms with a stream open** — LAI-142's gain is not spent.
