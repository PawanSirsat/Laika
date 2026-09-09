---
id: LAI-457
title: 'The Dashboard shows no throughput and no cycle time — it never calls `/metrics`'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-441
status: backlog
---

## Goal

**§11.4.2.1 says the Dashboard shows *"progress by status; activity feed with an
agent/human filter; stale warnings; throughput and cycle time."*** The last two
are absent, and the reason is not that they are hard:

```
$ grep -rn "metrics" server/web/src/
(nothing)
```

**`GET /projects/:slug/metrics` has been built and served since LAI-124.** The
client has no type for it and has never called it. The Dashboard renders from
`/activity` alone.

## Why this is worse than a missing screen

**A missing screen is visibly missing.** The Dashboard is shipped, populated, and
looks finished — so nobody opening it discovers that half of what §11.4.2.1
specifies was never wired. It has been that way since M5 closed.

## The payload, verbatim from `server/src/services/metrics.ts`

```ts
interface MetricsView {
  since: number;
  throughput: ThroughputBucket[];   // { day: string; completed: number }
  cycle_time: CycleTime | null;
}
interface CycleTime {
  measured: number;    // completed tasks that had a started_at
  unmeasured: number;  // completed tasks with none — counted, not measured
  p50_ms: number; p75_ms: number; p90_ms: number;
}
```

**Read the two comments in that file before designing the render** — they carry
the two decisions this screen must not contradict.

## Acceptance criteria

- [ ] The Dashboard calls `GET /projects/:slug/metrics` with the **same `since`
      window the activity feed already uses**, so the two halves of the screen
      describe the same period. **Two ranges on one screen is a wrong number, not
      a layout choice.**
- [ ] **`cycle_time: null` is not zero.** The service comments say *"`null` when
      nothing completed in the window — **not a zeroed shape**"*, and a p50 of
      `0ms` reads as "instant", which is the opposite of "nothing finished".
      Render the empty state, and **assert it** — a fixture with a null cycle
      time is required.
- [ ] **`unmeasured` is shown, not dropped.** A cycle time over 3 of 40 completed
      tasks is a different number from one over 40, and a screen that prints the
      percentile without the denominator is stating a confidence it does not
      have. §4.5's `started_at` is nullable precisely because this happens.
- [ ] **Days with zero completions render as zero, not as gaps.** The service
      already fills them — *"so a chart need not fill gaps"* — so a chart that
      re-derives its own axis is throwing away the guarantee.
- [ ] Percentiles are displayed in human units, not `p50_ms`. **Say which
      percentile**: an unlabelled "cycle time" is the one number on this screen
      people will quote in a meeting.
- [ ] The client type is added to the API layer and **matches the server view**,
      so LAI-213's client/server drift check covers it. If it does not pick the
      new type up automatically, **say so** — a new response type outside that
      check is its own finding.
- [ ] Both themes. Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Do not add an endpoint and do not change one.** Everything needed is served.

**And do not invent a fourth metric.** SPEC §14 q8 asks whether throughput and
cycle time are the right numbers at all — *"the obvious ones and may be the wrong
ones"*. That question is still open, and answering it is a decision, not
something to settle inside a render task. **Ship what is served; if it turns out
to be the wrong pair, that is q8's job.**
