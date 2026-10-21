---
id: LAI-823
title: 'Imports and bulk sweeps (09-20, 10-07, 10-15) dominate throughput, cycle time, the forecast and contribution'
area: server
assignee: strelka
priority: p2
depends-on: [LAI-822]
discovered-from: LAI-796
started: 2026-10-21T16:28:03Z
status: review
finished: 2026-10-21T17:29:50Z
---

## Goal

Delivery figures reflect real work, not one-off imports. **Decided (D-093,
2026-10-20): bulk sweeps are EXCLUDED** from contribution, throughput, cycle
time, the forecast and the heatmap, and stay visible in the activity feed
marked as bulk moves.

## Found (audit-metrics-sense, 2026-10-20)

- **Throughput:** 200 of 219 OnRoute finishes fall on two bulk days, 09-20
  (50) and 10-07 (150).
- **Cycle time:** the 30-day median is 190 h, and 179 h of that is waiting in
  review.
- **Sprint forecast:** it is fed by those days. It prints whole-range answers
  ("100% likely 0–12 of 12"), counts parents and subtasks both, and Laika
  shows "forecast once 10 are done" despite 358 done.
- **Heatmap:** 54% of Pawan's 12-week total falls on 3 migration days.

## Acceptance criteria

- [ ] **Bulk moves.** A rule that recognises a bulk move, for example more
      than N status changes by one actor within one minute, or an explicit
      import marker. **Tasks created straight into done in bulk are a bulk
      move too**, for example more than N tasks created into done by one
      actor within one minute, and are left out the same way. A rule that
      reads only status changes misses them: LAI-822's backfill
      (`0045_done_completed_at`) sets `completed_at = created_at` on a done
      task with no arrival at done in activity. By that rule, Laika's 358
      tasks, created straight into done on 10-15 and never moved since,
      carry a completion date of 10-15; the count on production was not
      measured. Those moves are excluded from throughput,
      cycle time, the forecast, contribution and the heatmap (D-093), and
      marked as bulk moves in the activity feed. The threshold is chosen
      from production evidence and written into SPEC.
- [x] **Cycle time** is split into "building" and "waiting for review".
- [x] **The forecast** counts top-level tasks only and never prints a
      whole-range answer as a forecast.
- [ ] **Tests and gate.**

## Owner decision (2026-10-21, via polly on Strelka)

1. **Rule, owner-approved:** a bulk move is one actor changing **more than 10
   distinct tasks within 60 seconds**; every move in that window is bulk.
2. **Treatment, delegated to polly:** bulk moves are **excluded** from
   throughput, cycle time, the sprint forecast, contribution and the heatmap,
   and every figure that left anything out says how many (`bulk_excluded`), so
   the UI can show "N bulk moves not counted". The activity log is untouched;
   nothing is deleted.
3. **Reason:** bulk days are 200 of 219 finishes and 54% of a heatmap, so
   marking alone would still distort every chart; the visible count keeps it
   honest.

Recorded on the card (LAIKA-623). Only Belka writes `docs/` (D-097), so the
SPEC and decision entry are **LAI-309**; the client half is **LAI-310**.

## Result (strelka)

**Server half built; two criteria left open on purpose.**

- **Bulk moves — not ticked.** The server half is done: the rule
  (`server/src/services/bulk-moves.ts`), exclusion with `bulk_excluded` in
  metrics, the forecast's `basis` and the heatmap, and `bulk: boolean` on
  every feed row (REST and SSE). Two parts are other owners': the threshold
  in SPEC (**LAI-309**, CHIEF) and contribution, which the Dashboard derives on
  the client from feed rows (**LAI-310**, SHELL — skip `bulk: true` rows).
- **Threshold, from production.** Production's whole activity log
  (7,233 rows, read through `GET /api/v1/activity`, 2026-10-21): per actor,
  the most distinct tasks in any 60 s — the known sweeps (09-20/21 import,
  10-07 bulk done, 10-15 mirror of 575 creations) peak at **19–73**; ordinary
  work at **≤ 10**; two runs reached 11, both mirror passes.
- **Choices made, for the reviewer:**
  - Distinct tasks, not rows: an agent's claim and finish of one task are two
    moves and one piece of work.
  - Status changes and creations are counted **apart**, by `actor_id`;
    system rows are never bulk.
  - Computed on read, not stored: `activity` is append-only and a sweep's
    first moves only become bulk when the later ones arrive. So a row
    streamed live mid-sweep can read `bulk: false`, then `true` on a reload.
  - A completion is bulk when the row that made it (move into done, or the
    creation) is bulk and sits at `completed_at` exactly — both writers stamp
    the same `now`.
  - Cycle time splits at the **latest** entry into review; no review ⇒ all
    building and no wait (`waiting_for_review: null` when none passed review).
  - Whole range = `low <= done && high >= total` → `forecast: null`,
    `reason: 'too_uncertain'`.
  - The heatmap now reads `activity` once — one person's moves and creations
    in the range, through `activity_actor_id_idx`. That amends §4.22's *"no
    profile read scans activity"*; the guard in `people-activity.test.ts` was
    narrowed to assert exactly that plan rather than removed (LAI-309 carries
    the SPEC wording).
- **Mutations**, each applied, confirmed landed, `bulk-moves.test.ts` run, file
  restored and checked byte-for-byte: 13 of 13 red, each on the test that
  names it (`>`→`>=`, `<`→`<=`, rows not tasks, mark only the window start,
  kinds merged, creation not a completion, metrics/forecast/heatmap/feed each
  keeping bulk, earliest review entry, subtasks kept, whole range printed).

## Gate — red by design (§4.4)

`uptime` 22:55 load 18.43 30.30 32.94 → 22:58 load 25.24 34.56 34.70.

```
pnpm test    → TEST 1   (server 3404 passed | 10 skipped; cli 533 pass 0 fail;
                         server/web 2688 pass, 2 fail)
pnpm lint    → LINT 0
pnpm format  → FMT  0
```

The two `server/web` failures:

1. **§4.4, the other half.** `test/api/view-type-drift.test.ts`, *"no server
   field is missing from its client type"*:
   ```
   EventView.bulk is served and ActivityEvent does not declare it — add it, or list it in clientOmits with a reason
   PeopleActivityView.bulk_excluded is served and PeopleActivity does not declare it — add it, or list it in clientOmits with a reason
   ```
   `clientOmits` lives in `server/web/`, so there is no exemption a server
   builder may take. **LAI-310 turns it green.** No other assertion fails.
2. **Load flake, not this change.** `test/browser/my-day-v2.test.ts`, *"a font
   wider than ours … never cut"* (`not ok 404 - a phone, and both themes
   (I)`). Alone, straight after, load ≈ 16: `node --test
   test/browser/my-day-v2.test.ts` → **31/31 pass, exit 0**. This diff touches
   nothing in `server/web/`. Browser flakes under load are LAI-715.

Branch `LAI-823-imports-bulk-sweeps-metrics`. Files: `server/src/services/{bulk-moves,metrics,sprint-forecast,people-activity,events,activity}.ts`,
`server/src/http/routes/events.ts`, `server/test/services/{bulk-moves,people-activity}.test.ts`,
`server/test/http/routes/people.test.ts`.
