---
id: LAI-870
title: "Agents lane: spread a point's agent seconds over at most a few minutes before it, never across the whole gap"
area: server
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-833
status: backlog
---

## Goal

A telemetry point's agent seconds land in the few minutes before the point's
end, never smeared across a laptop's sleep. One point can never fail the
whole telemetry request, tokens included.

## What is there today (read at `28cf1877`)

- **Where the spread starts.** `recordTelemetry` takes the start of the
  spread as `since`. For a cumulative series that is its last point's end,
  `Math.max(p.startMs, held.lastEndMs)`; for a delta it is the point's own
  start, `p.startMs` (`server/src/services/token-telemetry.ts:830`). It
  calls `bucketsAdded.push(...spreadActive(p.sessionKey, since, p.endMs, add))`
  (`:854`).
- **How it spreads.** `spreadActive` (`server/src/services/agent-time.ts:92`)
  spreads the seconds over every five-minute bucket from `since` to the end,
  in proportion. Seconds past the interval's length go back from its end
  (`:99`, `from = Math.min(startMs, endMs - seconds * 1000)`).
- **What is drawn.** My day draws any bucket above 0 seconds
  (`server/web/src/routes/screens/my-day/timeline-derive.ts:230`).
- **So, when a laptop sleeps while an agent works,** under a minute of work
  is drawn as an "Agent working 11 PM–8 AM · 1 min" bar, and the day's axis
  widens to midnight.
- **Measured, with the real `spreadActive`** (Node 22.18, on Belka):
  - 40 s over a 9-hour gap becomes **108 buckets of 0.370 s** each.
  - A delta point whose start is `"0"` becomes **5,975,520 buckets** at an
    end of 2026-10-22 08:00 UTC. `push(...)` then throws
    `RangeError: Maximum call stack size exceeded`. The throw is inside the
    receiver's transaction, so **the whole request fails, tokens
    included**.
  - A delta point over one minute carrying **1e9 s** becomes **3,333,334
    buckets**, and throws the same way. That is the back-from-end rule at
    `agent-time.ts:99` at work, not the start. So clamping the start alone
    does not stop it.
- **The parser accepts a start of `"0"`.** `msOf` reads any string of
  digits, and six or fewer of them is `0` ms (`token-telemetry.ts:186-192`).
  The window filter checks only start ≤ end and the end's day (`:771-774`).
- **SPEC §4.57** (`docs/SPEC.md:2056-2059`) says: *"Each point's added
  seconds are spread over the buckets its interval covers, in proportion."*

## Acceptance criteria

Criteria 1, 2 and 2b fail today. Criterion 3 is a guard that passes before
and after. Criterion 4 proves 1, 2 and 2b can fail.

- [ ] **1. A long gap.** A cumulative series has points at 23:00 and 08:00,
      the second adding 40 s. It puts no lane seconds in a bucket before the
      one holding 08:00 − `SPREAD_MAX`, and the lane's seconds for that
      point still sum to 40 (within floating-point rounding). Today it fills
      108 buckets from 23:00.
- [ ] **2. A start of `"0"`.** A delta point whose start time is `"0"`,
      carrying 10 s:
      - is stored without error, along with the other points in the same
        request;
      - the day's agent minutes include the 10 s;
      - at most `SPREAD_MAX / 5 min + 1` buckets are written. The `+ 1` is
        there because a span not aligned to five minutes touches one more
        bucket: ten minutes ending 08:02 touch 07:50, 07:55 and 08:00.

      Today it throws `RangeError`.
- [ ] **2b. A huge point.** A delta point over one minute carrying 1e9 s is
      stored without error, along with the other points in the same request,
      and writes a bounded number of buckets: at most `LANE_MAX / 5 min + 1`.
      Today it throws `RangeError`.
- [ ] **3. Nothing else moves.** The existing tests in
      `server/test/services/agent-time-lane.test.ts` stay green, unchanged.
      That includes *"puts more seconds than an interval spans back from its
      end"* (`:147`), which reports 900 s over one minute and expects the 15
      minutes before its end. That stays true because the clamp moves only
      the start, and `spreadActive`'s own rule (`agent-time.ts:99`) places
      the rest. `agent_time_days` totals are unaffected: they are counted by
      the end's day, not by bucket (`token-telemetry.ts:851`, `:855-858`).
- [ ] **4. Mutation.** Two mutations, each confirmed landed (a unique anchor
      and a `grep`), restored in a trap, and recorded here:
      - remove the start clamp: criteria 1 and 2 go red;
      - remove the `LANE_MAX` bound: criterion 2b goes red.

      Each goes red with assertion errors, not with a crash of the test
      runner.
- [ ] **The value is justified.** `SPREAD_MAX` is between 5 and 10 minutes,
      as a named constant. The task file says why that value, against how
      often Claude Code exports (an export interval longer than `SPREAD_MAX`
      would bunch a busy agent's seconds toward the end).
- [ ] **SPEC, a named edit (D-033/D-034):** §4.57's sentence at
      `docs/SPEC.md:2056-2059` says the seconds are spread over at most
      `SPREAD_MAX` before the point's end. Nothing else in SPEC is granted.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **Discovered from LAI-833** (PR #11, already live), by today's
  after-the-fact review.
- **The fix, in two parts:**
  - Clamp the spread's start to `endMs − SPREAD_MAX`, in `recordTelemetry`
    before the call at `:854` or inside `spreadActive`. You pick the place.
    The back-from-end rule at `agent-time.ts:99` still places seconds that
    do not fit.
  - Also bound `from` after `agent-time.ts:99`, to
    `max(…, endMs − LANE_MAX)`, with `LANE_MAX` at least 15 minutes. At 15
    minutes or more, the existing test at `agent-time-lane.test.ts:147` (900
    s over one minute, the 15 minutes before its end) stays green.
  - Seconds past `LANE_MAX` need no extra rule: a bucket is capped at 300 s
    on insert (`agent-time.ts:132`).
- Files: `server/src/services/token-telemetry.ts`,
  `server/src/services/agent-time.ts`,
  `server/test/services/agent-time-lane.test.ts`, and the SPEC sentence
  above. No web change. No new dependencies.
- **Buckets already stored stay** until they age out (40 days; *"is kept 40
  days"*, `agent-time-lane.test.ts:206`). There is no backfill.
- Replacing `push(...spread)` with a loop is fine as extra hardening. It does
  not replace the clamp or the bound: criteria 2 and 2b's bucket bounds still
  need them.
- **Out of scope:** a 1e9 s point still adds 1e9 s to the day's agent
  minutes. `agent_time_days` checks only `seconds >= 0` (`schema.ts:2465`).
  Whether one point may claim more than its day is a separate question; file
  it if it matters.
