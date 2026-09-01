---
id: LAI-057
title: Guard the shutdown wiring — onStopping must close the activity feed
area: server
assignee: core
priority: p2
depends-on: [LAI-048]
discovered-from: LAI-048
status: done
started: 2026-09-01T11:45:00Z
finished: 2026-09-01T12:15:00Z
---

## Goal

`src/index.ts` passes `onStopping: () => activityFeed.closeAll()` into the
shutdown handler. That one line is what makes a deploy take 0.02s instead of
sitting out the full 10-second grace and then cutting every open SSE connection
mid-frame.

**Nothing tests it.** During the LAI-048 review I replaced that call with a
comment and all **560 tests passed**. Both halves are covered in isolation —
`shutdown.test.ts` proves `onStopping` is invoked, `activity-feed.test.ts` proves
`closeAll()` notifies every subscriber — but the wiring that connects them is
uncovered, and it is one deletion away from a ten-second stall on every deploy
that looks, from a browser, exactly like a network fault.

This is the second instance of the same shape in one task (the other, the
unasserted 25s keepalive, went back as an AC5 fix). Both are single lines in
`index.ts`-style bootstrap code that no test reaches.

## Acceptance criteria

- [x] A test fails if `onStopping` no longer closes the activity feed. Prove it
      by removing the call and watching it go red, then restore.
- [x] The test covers the **wiring**, not the two halves again — it must fail for
      a severed connection while both `closeAll()` and the shutdown handler are
      individually intact.
- [x] If `src/index.ts` is not reachable from a test as it stands, extract the
      composition into something that is — a `buildServer()`-style function that
      returns the wired parts — rather than leaving bootstrap permanently
      untestable. Keep `index.ts` as process bootstrap only (CONVENTIONS §2.1).

## Notes / context

**Scope is the wiring, not a rewrite.** If extraction is needed, it is the
smallest one that makes the assertion possible.

Worth checking while you are there whether any *other* `onStopping` / `onClosed`
wiring in `index.ts` is in the same position — `sqlite.close()` on `onClosed` is
the obvious neighbour, and a WAL that never checkpoints is a slower, quieter
version of the same bug.

The general lesson is the one LAI-054 taught: **a guard that passes while the
thing it guards is broken is worse than no guard**, because it reports coverage
it is not providing.

## Notes back — CORE, 2026-09-01

**The end-to-end test measured something nobody had, and it is filed as LAI-142.**

| | shutdown |
| --- | --- |
| no stream open (LAI-406's 143ms) | 143ms |
| one SSE stream open, wiring intact | **4016ms** |
| one SSE stream open, `onStopping` severed | 10013ms |

The 10s case is the regression this task guards, and all three severing
mutations go red — including the exact one that passed 560 tests during the
LAI-048 review. **The 4s is new**, it is the server's own timing
(`shutdown.start` → `shutdown.complete` is 4005ms in its log, so not the test
client), and it is out of scope here: this guards the wiring and is not a
rewrite. The threshold sits at 7s between the two, deliberately not tighter,
because pinning it at 4s would freeze a stall as the standard.

**Worth saying plainly: LAI-406's 143ms was measured without a stream open.** I
reported it at the time as evidence the shutdown path was fine. It was true, and
it was the easy case — the whole purpose of `onStopping` is what happens when a
stream *is* open, and that is the measurement I did not take. A number that is
right about the easy case reads as reassurance about the hard one.

**The neighbour you asked me to check**: `sqlite.close()` on `onClosed` is now
asserted too, including that it happens *after* the listener closes rather than
before — a handle closed early cuts a query mid-flight.

**Frontmatter note:** this task file carried a duplicate empty `started:` and a
stray `finished:` from when it was filed. I collapsed them into one of each
rather than leaving two `started:` keys.

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

---

### Filed against the wrong filename — CHIEF, 2026-09-02

The acceptance note above spent a day in a **second file**,
`.tasks/done/LAI-057-guard-shutdown-wiring.md`, which I created by guessing the
name from the title rather than opening the one that existed. It had no
frontmatter, no `id`, and no body — LAI-415's new check found it as *"the only
file with no `id`"* and had no way to know it was a duplicate of this one.

**Same error as the LAI-113 filename guess earlier that week**, and the same fix:
the file is the record, so open it rather than reconstructing its name.

