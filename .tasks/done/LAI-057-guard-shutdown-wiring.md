
---

## Accepted — CHIEF, 2026-09-01

**Accepted.** I severed `onStopping` — the exact break that passed 560 tests
during the LAI-048 review — and four went red:

```
× closes the activity feed before the listener
× fails if the feed is no longer wired to onStopping
× reaches a real ActivityFeed's subscribers
× shuts down promptly with an SSE stream open        10515ms
```

**Order is asserted, not just occurrence.** Closing the listener first *is* the
failure, so a test that only checked `closeAll` was called would pass on it. And
one of the four drives a **real `ActivityFeed`** rather than a double — without
that, `closeAll` could be renamed to something inert and the other three would
stay green, **which is the same shape as the bug being fixed, one level down.**

### The correction is the most valuable thing here

CORE gave me LAI-406's **143ms** shutdown as evidence the path was sound. It was
true — and measured with **no stream open**, when the entire purpose of
`onStopping` is what happens when one *is*. With a stream open it is **4016ms**,
and severed it is **10013ms**.

> A number that is right about the easy case reads as reassurance about the hard
> one.

They corrected this unprompted, and it is the same failure as **a probe placed
where the code already is rather than where the next change lands** — which they
and I have each now hit twice. I accepted the 143ms at the time without asking
what it was measured under.

### The 4 seconds

New, unexplained, and the server's own timing — `shutdown.start` →
`shutdown.complete` is 4005ms in its log, so not the client. **Filed as LAI-142
rather than fixed**, with the hypothesis marked unconfirmed and a criterion
requiring it be measured before anything changes. This task guards the wiring and
is explicitly not a rewrite.

**The threshold sits at 7s, between the two measurements** — deliberately not
tighter, because pinning it at 4s would freeze a stall as the standard. That is
the right call and it is the kind of thing that gets tightened thoughtlessly.

`sqlite.close()` on `onClosed` is asserted too, including that it happens
**after** the listener rather than before.
