---
id: LAI-142
title: Shutdown takes 4s with an SSE stream open, not the 0.1s it takes without
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-057
status: review
started: 2026-09-02T05:25:00Z
finished: 2026-09-02T06:00:00Z
---

## Goal

LAI-057 added an end-to-end guard: boot the built server, open an SSE stream,
`SIGTERM`, and measure. It works — and it measured something nobody had.

| | shutdown |
| --- | --- |
| no stream open (LAI-406 measured this) | **143ms** |
| one SSE stream open, wiring intact | **4016ms** |
| one SSE stream open, `onStopping` severed | **10013ms** (full grace, forced exit) |

The 10s case is the bug LAI-057 guards and it is fixed. **The 4s case is new.**
It is the server's own timing, not the test client's — `shutdown.start` →
`shutdown.complete` in the server log is 4005ms.

So `activityFeed.closeAll()` ends the SSE *response*, and something then holds
the process for another four seconds.

## The likely cause, unconfirmed

`createShutdownHandler` calls `closeIdleConnections()` **once**, immediately
after `onStopping`. An SSE connection that has just been ended is probably not
idle *yet* at that moment — the response still has to flush — so it is not
reaped, and once it does go idle nothing calls `closeIdleConnections()` again.
It then waits out Node's `keepAliveTimeout`, which defaults to 5s and would
account for roughly this.

**That is a hypothesis from reading the code, not a measurement.** Confirm it
before changing anything.

## Acceptance criteria

- [x] The cause is **measured**, not inferred. If it is the keep-alive timeout,
      show it — an instrumented run, a `server.getConnections()` count, or a
      changed timeout moving the number.
- [x] Shutdown with an open SSE stream is close to the no-stream case. If some
      floor is unavoidable, say what it is and why.
- [x] LAI-057's threshold in `build.test.ts` is tightened to match, with the new
      measurements in the comment. It sits at 7s **only** because 4s is not a
      number worth freezing as correct.
- [x] The severed case still fails. Whatever changes here, removing
      `onStopping`'s `closeAll()` must still take the full grace period —
      otherwise this task has removed LAI-057's guard while making it faster.

## Notes / context

No new dependencies.

Not urgent: 4s is a slow deploy, not a broken one, and `docker stop`'s default
timeout is 10s so nothing escalates to SIGKILL today. It is worth doing because
the same delay applies to every deploy with a single browser tab open on the
board, which is the normal case rather than the edge one.


---

## Submitted — CORE, 2026-09-02

**4022ms → 57-68ms.** Fully green: 1635 server, 585 web, lint and format clean.

### Measured, and the task's hypothesis was wrong

| | before | after |
| --- | --- | --- |
| no stream open | 9ms | 10ms |
| one SSE stream | **4022ms** | **57-68ms** |
| one stream, `onStopping` severed | 10013ms | **10010ms**, `shutdown.forced` |

**The keep-alive hypothesis is refuted.** Setting `keepAliveTimeout` to 1000ms
moved the number to **2027ms** — so it participates — but setting it to 8000ms
left it at **4012ms**, so something else caps it near four seconds. I did not
chase what: the cause below makes it irrelevant, and the fix is the same either
way.

**The cause, measured directly.** A probe on `getConnections()` every 250ms
through the shutdown reported `open: 1` for the entire four seconds:

```
at_ms 250  open 1
at_ms 1003 open 1
...
at_ms 4011 open 1
shutdown.complete
```

The connection was never reaped — it was **outlived**. `closeIdleConnections()`
ran once, immediately, while the stream's response was still flushing and the
connection therefore not *idle*; nothing looked again. Reaping on a 50ms interval
until `close()` reports done takes it to 57ms.

### The floor, since AC2 asks

**One reap interval.** 57ms against the 9ms no-stream case, and the difference is
`REAP_INTERVAL_MS`. It cannot be lower without spinning, and there is no
deployment for which a different number is better — it runs only during shutdown
and only until close completes.

### AC4, verified rather than assumed

With `onStopping`'s `closeAll()` severed, a stream open still takes the **full
grace**: 10010ms ending in `shutdown.forced`. Making shutdown faster must not
delete the test that catches the stall it was written for, and it did not — the
severed stream is never idle, so the reaper cannot touch it.

### A real bug my own unit test found

The reaper was created **after** `server.close()`, whose callback clears it. A
`close()` callback can fire **synchronously** — every test double does, and a
server with nothing to drain does too — so `reaper` was cleared before it was
initialised. The end-to-end measurement passed the whole time, because a real
server with an open connection closes asynchronously.

It is created before the call now, with the reason at the site.

Three unit tests on the reaper: it keeps looking, it stops when the server
reports closed, and it stops when the grace period forces the exit — a timer
outliving the shutdown it belongs to being the same class of bug as the stream
that started this task.
