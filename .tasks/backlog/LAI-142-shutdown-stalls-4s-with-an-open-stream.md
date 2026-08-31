---
id: LAI-142
title: Shutdown takes 4s with an SSE stream open, not the 0.1s it takes without
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-057
status: backlog
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

- [ ] The cause is **measured**, not inferred. If it is the keep-alive timeout,
      show it — an instrumented run, a `server.getConnections()` count, or a
      changed timeout moving the number.
- [ ] Shutdown with an open SSE stream is close to the no-stream case. If some
      floor is unavoidable, say what it is and why.
- [ ] LAI-057's threshold in `build.test.ts` is tightened to match, with the new
      measurements in the comment. It sits at 7s **only** because 4s is not a
      number worth freezing as correct.
- [ ] The severed case still fails. Whatever changes here, removing
      `onStopping`'s `closeAll()` must still take the full grace period —
      otherwise this task has removed LAI-057's guard while making it faster.

## Notes / context

No new dependencies.

Not urgent: 4s is a slow deploy, not a broken one, and `docker stop`'s default
timeout is 10s so nothing escalates to SIGKILL today. It is worth doing because
the same delay applies to every deploy with a single browser tab open on the
board, which is the normal case rather than the edge one.
