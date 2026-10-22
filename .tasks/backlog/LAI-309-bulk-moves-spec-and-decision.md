---
id: LAI-309
title: 'SPEC and DECISIONS for bulk moves: the rule, the bulk_excluded counts and the split cycle time (LAI-823)'
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-823]
discovered-from: LAI-823
status: backlog
---

## Goal

The docs half of LAI-823 (§4.4). LAI-823 builds the server half; only Belka
writes `docs/` (D-097), so the rule and the payloads it changed are written
here.

## The owner's decision (2026-10-21, via polly on Strelka)

1. **Rule, owner-approved:** a bulk move is one actor changing **more than 10
   distinct tasks within 60 seconds**; every move in that window is bulk.
2. **Treatment, delegated to polly:** bulk moves are **excluded** from
   throughput, cycle time, the sprint forecast, contribution and the heatmap,
   and every figure that left anything out reports how many
   (`bulk_excluded`), so the UI can say "N bulk moves not counted". The
   activity log is untouched; nothing is deleted.
3. **Reason:** bulk days are 200 of 219 OnRoute finishes and 54% of a
   heatmap; marking alone would still distort every chart, and the visible
   count keeps it honest.

## Acceptance criteria

- [ ] **A D-number** records the decision above, amending D-093 item 2.
- [ ] **SPEC states the threshold and the rule**, as `server/src/services/bulk-moves.ts`
      implements it: more than 10 distinct tasks, by one actor (`actor_id`),
      within any 60 s window containing the row (`< 60 000` ms between the
      first and last), status changes (`task.status_changed`) and creations
      (`task.created`) counted apart; system rows never bulk. A completion is
      bulk when the row that made it — the move into done, or the creation —
      is. Evidence: production's 7,233 activity rows on 2026-10-21; the known
      sweeps peak at 19–73 distinct tasks a minute per actor, ordinary work at
      10 or fewer (two runs of 11, both mirror passes).
- [ ] **§6.4 `GET /projects/:slug/metrics`** names `bulk_excluded`, and
      `cycle_time.building` / `cycle_time.waiting_for_review` (each
      `{ measured, p50_ms, p75_ms, p90_ms }` or `null`; split at the latest
      entry into review; no review ⇒ all building, no wait).
- [ ] **The sprint forecast paragraph** (SPEC, "The sprint forecast
      (LAI-772)") says: top-level tasks only, in the sprint and in the
      history; bulk completions left out, `basis.bulk_excluded`; a range from
      what is done to every task is `forecast: null`, `reason:
      'too_uncertain'`.
- [ ] **The heatmap read** names `bulk_excluded`, and §4.22's *"no profile
      read scans `activity`"* is amended: the heatmap reads one person's
      moves and creations in the range through the actor's index.
- [ ] **The activity feed rows** (`GET /activity`, `/projects/:slug/activity`,
      `GET /events`) carry `bulk: boolean`; a row streamed live while its sweep
      is still arriving can read `false` and later `true`.
