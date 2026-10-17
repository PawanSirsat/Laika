---
id: LAI-771
title: 'Size and forecasts, phase 1: every task gets a computed size (XS-XL) with its why, a build-time forecast beside the actual, an override, and per-project accuracy (server/ + server/web/ + docs/)'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-17T13:52:30Z
status: done
finished: 2026-10-17T14:57:36Z
---

## Goal

The owner wants a difficulty on every task that updates itself, and predicted
time beside actual time so estimates improve. When this is finished, each task
carries a size XS / S / M / L / XL (weights 0.25 / 0.5 / 1 / 2 / 4, relative to
the project's typical task) computed from its own text and from similar
finished tasks in the project, a build-time forecast as a p50–p80 range, the
actual build time once finished, a *why*, and a person's override. D-085 is the
contract. Research with a back-test on 341 tasks: ~/Documents/laika-strategy/task-estimation/REPORT.md.

## Acceptance criteria

- [x] **Computed inside Laika**, no outside service: signals from the task (acceptance text length, criteria count, subtasks, tags, dependencies) plus the k most similar finished tasks in the same project (cheap local text similarity). A back-test over the board's own finished tasks (each prediction using only earlier tasks) reports typical error against the plain project median; the method must beat the median.
- [x] **Recompute** on create, on edit of title/description/acceptance, on subtask or dependency change — keyed on a hash of the inputs so irrelevant edits cost nothing; under 5 ms per recompute measured; refit nightly via the scheduler. A parent's size and forecast come from its children.
- [x] **Frozen at claim:** the forecast in force when work starts is stored; estimate-vs-actual always uses that copy. Estimates kept in an append-only history table (migration **0036**, additive only).
- [x] **Build time** = first start to first finish; review wait and rework shown separately.
- [x] **Cold start:** size only; hours shown after 10 finished tasks in the project.
- [x] **Override:** a person can set the size (who may: anyone who may edit the task); the override is shown, the computed one stays visible under *why*.
- [x] **UI:** size badge on board cards and a List column (sortable); task panel section with size, *why* (each factor's contribution, links to the similar tasks), forecast range, actual, override control; a per-project accuracy figure. Light and dark, laptop and phone.
- [x] **Agents:** `get_task_context` returns size, forecast and why; `create_task`/`update_task` accept an optional size override.
- [x] **Never a score of people:** accuracy per project (and per agent client only with k ≥ 3 people), never per person (D-078 item 6, D-085 item 8).
- [x] SPEC §1.1 note and the new sections; D-085 already written.
- [x] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- Migration **0036** is reserved; LAI-769 (parallel) takes 0035. Whichever merges second regenerates its migration and journal properly (never just renames).
- Token forecasts are phase 2 (LAI-772). No new dependencies. Owner-direct.

## Notes / decisions taken while building

**What was built**

- `server/src/services/estimate-model.ts` (new, pure) — the model: signals read
  from a task (words of description + acceptance, criteria, blocked-by count,
  tags), a ridge regression in log space shrunk towards 0.9 per log word, the
  7 most similar finished tasks by TF-IDF cosine (inverted index), the blend,
  level bands (×√2 edges), the *why* as exact factor contributions in levels,
  the parent roll-up (Fenton–Wilkinson sum of log-normals), and `backtest`
  (time-ordered, history finished before each start only; sliding TF-IDF
  window). Priority is read and given 0, and the *why* says so.
- `server/src/services/estimates.ts` (new) — fitted model per project cached in
  memory; `refreshEstimate` inline on create / title / description /
  acceptance / tags / parent / dependency / child cancelled; `estimate_hash`
  short-circuit; a `model` row only when the output moves (level, forecast
  presence, p50 > ×1.1, subtask count); `freezeEstimateAtStart` at the first
  start (claim or any move into in_progress); `setSizeOverride`; `sizeViews`
  (one query per page); `getTaskEstimate`; `getEstimateAccuracy` (frozen copy
  vs actual; by agent client only with ≥ 3 people; nothing per person);
  `refitEstimates` (system principal, nightly and at boot).
- Migration `0036_task_estimates.sql` — **additive**: `CREATE TABLE
  task_estimates` + 2 indexes, four nullable `ALTER TABLE tasks ADD`
  (`estimate_id`, `estimate_at_start_id`, `size_override_id`,
  `estimate_hash`) + 3 indexes. Append-only triggers (no update / delete /
  replace) ride `ensureActivityTriggers`. A test migrates a populated
  database and asserts `tasks` kept its root page and every row.
- REST: `size` on `POST /projects/:slug/tasks` and `PATCH /tasks/:id`;
  `GET /tasks/:id/estimate`; `GET /projects/:slug/estimates/accuracy`;
  `TaskView.size`. MCP: `get_task_context` returns `estimate` and a Size
  section; `create_task` / `update_task` take `size`.
- Web: `SizeChip` (card, List, panel), the card field `size` (a View
  settings toggle, on by default), the List's sortable Size column (unsized
  last both ways), `ForecastSection` under Acceptance (size, who set it and
  Laika's beside it, override via the app's Dropdown, build-time range, the
  frozen copy, actual build / review wait / rework, the *why* with links to
  the similar tasks, the project's accuracy line).
- SPEC §1.1, §3.4, §4.5, §4.13, §4.32, §6.4, §7.1, §11.4, §11.6.

**Measured**

- Back-test over the board's own finished history (`.tasks/done/`, tasks
  finished before 2026-10-17; `server/test/tooling/estimate-backtest.test.ts`
  prints it on every run): 329 tasks, 200 predicted — typical error
  **×1.65** against **×2.08** for the plain project median; p80 held **84%**.
- The same history seeded into a real Laika through the services with a
  nightly refit per simulated day: Laika's own back-test ×1.68–1.71 vs ×2.08;
  frozen-at-claim forecasts against actuals over 320 tasks ×1.78, bias 1.01,
  p80 held 77%.
- Recompute on a project with 300 finished tasks: median 0.22 ms, p95 0.45 ms
  (hash hit 0.13 ms); full refit with back-test ~84–100 ms. The test asserts
  p50 and p95 under 5 ms on 120 finished tasks.

**Decisions taken while building**

- **The p50 is calibrated too, not only the p80.** On recent history the
  model ran ×1.65 long (agents got faster than the history they learn from),
  which made ranges look narrow around a p50 that was itself too high. Both
  ends now move by the model's own past errors (split conformal, the R&D's
  §5.3), in the forecast and identically in the replay: the method error
  went from ×1.74 to ×1.65 on the same history.
- **The override changes the size shown, not the hours**: the forecast is
  the model's, and the panel says "Laika computed …" beside a person's size.
  Accuracy measures the model's frozen forecast, never the override.
- **A done or cancelled task keeps the estimate it has**; the nightly refit
  estimates one that has none, once.
- **A cold fit is refitted when the project grows by a tenth or reaches 10
  finished tasks**; a warm one nightly, as D-085 says.
- **`system.estimate.refit`** is a new §3.4 system action, so the nightly job
  asks `can()` like every other cron write.
- **No new activity verb.** An override writes `task.updated` with
  `{ field: 'size', from, to }`; a model row writes no activity (derived, as
  `ready` is).
- **Migration numbered 0036** with its snapshot and journal tag, as reserved;
  idx 35 in the journal. Whichever of LAI-769 / LAI-771 reaches master
  second regenerates on top of the other's.

**Deferred** (phase 2, LAI-772 and after): token forecasts, the agent's own
estimate at claim, the org AI provider as a source, per-source scoring and
inverse-variance weights, sprint planned-vs-completed weight, recency
weighting in the regression, the accuracy trend.


## Review round 1 — CHANGES REQUIRED (B1), fixed

- **B1 — an estimator failure broke task writes.** Every inline estimator
  call now goes through one helper (`bestEffort` in `services/estimates.ts`):
  a savepoint (`immediate` when not nested), the failure logged as
  `estimate.failed`, the task write carried on. `claimTask` and
  `changeStatus` run the freeze and the parent refresh **after** the activity
  row. `updateTask` is one transaction, so a person's size that cannot be
  stored saves nothing of that edit rather than half of it. The freeze is
  defined as the newest `model` row written at or before `started_at`, and the
  nightly refit applies it where a failure skipped it — never an estimate
  written after work began, and never for a task that started before any
  estimate existed.
- **Agent-client accuracy** counts the distinct people behind the measured
  tasks only (first round by the client, with a frozen forecast and an
  actual), not every finisher (D-078 item 6).
- **`get_task_context`** answers with *Size: unavailable* when the estimate
  cannot be read, instead of failing.
- Tests, shown failing first: the forced failure (temporary triggers refusing
  every estimate write) for a create, an edit, a claim and a status change,
  each saved with its activity row; a size that cannot be stored saving
  nothing; the freeze retried by the refit with the estimate in force at the
  start; no hindsight freeze; the client rule; the MCP fallback.

## Accepted

2026-10-17: accepted by CHIEF (Omnigent) on the owner's direct instruction, after one Claude review. The review's one blocker (an estimator failure broke task writes, and in `changeStatus` left a start with no activity row) was fixed in `3e942c81` with tests that failed first; CHIEF read the fix (`bestEffort` savepoint wrapper, activity row before the freeze, freeze retried by the refit) before merge. Also fixed: per-client accuracy counts distinct finishers among measured tasks only, and `get_task_context` degrades to "Size: unavailable". Left open: mid-day refit for fast-growing young projects; the inline rebuild cost on large cold projects.
