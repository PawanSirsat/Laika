---
id: LAI-772
title: 'Size and forecasts, phase 2: token forecasts beside actuals, agent estimate at claim, sprint forecast, suspiciously-fast cue, rework cost, similar past tasks for agents'
area: server
assignee: owner-direct
priority: p2
depends-on: [LAI-770, LAI-771]
discovered-from:
status: review
started: 2026-10-17T20:23:26Z
finished: 2026-10-17T21:30:11Z
---

## Goal

With attributed token actuals (LAI-770) and sizes (LAI-771) in place, forecast
tokens as a p50–p80 range beside the actual, and use the forecasts to help the
review gate. D-085; research: ~/Documents/laika-strategy/task-estimation/REPORT.md §§5–9.

## Acceptance criteria

- [x] Token forecast per task (p50–p80) calibrated per project on attributed actuals; shown only after 10 tasks with attributed token data; predicted beside actual in the task panel.
- [x] Agent estimate at claim (optional field on `start_working`), zero weight until it beats the project median.
- [x] Sprint forecast ("85% likely to finish 18–23 of 26") from throughput and weights.
- [x] Review page cue: finished below 0.25× forecast p50 with no confirmed evidence → "check this one".
- [x] Rework cost per project: tokens and time after a send-back (project level only).
- [x] `get_task_context` lists similar past tasks and why they were sent back.
- [x] "Scope grew after start" note when the size rises a level after claim; split suggestion for XL.
- [x] Root gate exit 0 on all three.

## Notes / context

- No per-person accuracy or rework figures (D-078). Owner-direct.

## Builder notes (at review)

Commits on `build-token-forecasts` (from `master` 90ed0358): efcf7e0d,
81f17f14, d5503866 (server), c370a718, b304ae3f, 9342bd52, 0b39a366 (web),
a228ef34 (SPEC). Migration **0038_token_forecasts** (additive: `CREATE TABLE
task_claim_estimates` + index, two nullable `ALTER TABLE task_estimates ADD`),
generated with the LAI-778 wrapper. **LAI-780's `0038_tasks_external_ref_index`
reaches master first** (the orchestrator said so): when told, this branch
merges `master`, deletes its own 0038 SQL, snapshot and journal entry, and
regenerates with `pnpm db:generate --name token_forecasts` on top (never a
rename). No new dependency.

**What was built**

- **Token forecast** (`services/token-model.ts`, pure; `estimates.ts`): build
  tokens (input + output + cache writes on days up to the first finish's UTC
  day) against the task's size weight at the start, `log tokens = a + b·log
  weight`, slope ridge-shrunk to 1. **Attributed actuals only**: a task counts
  when ≥ 70% of its people's tokens those days were tied to a task (the R&D's
  §5.2), weighted by that share. Shown once 10 such tasks exist. Time-ordered
  back-test against the weighted median; p50/p80 calibrated on its residuals;
  falls back to the median range when it does not beat it. Stored on the
  `task_estimates` row (`tokens_p50/p80`), so the claim freezes it with the
  hours; a row is also written when the token p50 moves > ×1.1.
- **Panel**: Forecast section — Tokens range, the frozen range under *At
  start*, *Actual tokens* (build, "so far" until the first finish), the
  scope-grew / split / said-at-claim notes, a token accuracy line. Tokens
  section — a *Forecast* figure beside the actual.
- **Agent estimate at claim**: `start_working { estimate: { size?, confidence?
  } }` and `POST /tasks/:id/claim` (same body) → `task_claim_estimates`
  (append-only, three triggers via `ensureActivityTriggers`; no person column).
  Stored best effort after the claim's activity row. Sizes scored against
  build times through the model's calibration at the start: **weight 0 until
  ≥ 10 scored tasks beat the plain median**, then inverse variance vs the
  model, capped 0.9, blended in log space and shown as an `agent` factor.
  Confidence scored against send-backs per project. A resume keeps none.
- **Sprint forecast**: `GET /sprints/:id/forecast` — Monte Carlo
  (`sprint-forecast-model.ts`, seeded, 2000 draws, ≤ 366 days) over the
  project's last 42 days of finished size weight per day; tasks finished in
  order review → in progress → to do → backlog; narrowest central range with
  ≥ 85%; cached per sprint against every input. Sprints page card line.
- **Review cue**: `GET /review` items carry `cue` when round 1 finished in
  < 0.25× the frozen build p50 and CI has not confirmed the round. *check this
  one* chip, a *Check these* count and a filter.
- **Rework cost**: `GET /usage` → `rework[]` per project the reader may read:
  send-backs decided in the range, tokens after the sent-back round's day,
  time to the next finish (or now), open count, share. Usage page card.
- **`get_task_context`**: `similar` — up to 5 similar finished tasks (the
  model's TF-IDF index, at any project size) with rounds and **send-back
  reasons only**; a Similar section; Tokens / Said at claim / Scope grew /
  XL split lines under Size.
- **Scope grew** (computed level ≥ frozen + 1) and **split** for XL (mean
  rounds of finished XL tasks, from 3).
- SPEC §1.1, §4.32, new §4.34, §6.4, §7.1, §11.4.

**Tests first** — each shown failing before its code: token model 10 (module
missing), sprint model 6, agent scoring + similar lookup 5, service tests 19
(`estimates.forecasts.test.ts`), sprint forecast service 5, rework 4, MCP/REST
4 (two guards — unknown estimate refused — passed before too, by the strict
schemas), web helpers (estimates, sprints, usage red on missing exports). The
web review filter test was written with its code, not run red on its own. The
five new UI browser cases were run against the **old components** (swapped in
from `HEAD`, restored by checksum): 5/5 red, then green. Migration test for
0038 written after it was generated (a guard).

**Back-test of the token forecast — the attributed history that exists**
(aggregate only; the real collector over this machine's transcripts in a
scratch state dir, the board's own start / first finish / size weight for each
usable task via `get_task_context`; per-key data deleted after):

- 116 task keys carry attributed tokens on this machine (107 ONR, 9 SKYNET,
  **0 LAIKA** — LAI-780); coverage p25/p50/p75 0.26 / 0.42 / 0.47. **12 reach
  70% coverage, all ONR**, all built on one day (2026-09-26); build tokens
  2,962 – 979,753 (median 172,659).
- **Time-ordered (the honest one): n = 2** — ×1.31 against ×1.46 for the
  median, p80 held 2/2. Too few to mean anything.
- Leave-one-out with hindsight (not time-ordered, for scale only): **×2.77
  against ×2.70 for the median** — on this set the size does not explain
  tokens better than the median. The fit's slope is 0.56; with ≥ 15 replayed
  tasks the method would fall back to the median range on its own.
- The weights used are the board's current ones (computed 2026-10-17, after
  these tasks finished); none of them has a frozen-at-start estimate.

**Measured on a seeded instance** (screenshots' instance): back-test ×1.18 vs
×1.42 median over 23 tasks; `get_task_context`, the panel, the sprint line
("88% likely to finish 8–11 of 17"), the cue and rework all answered over the
real API.

**Screenshots**: `/tmp/laika-token-forecasts-shots/` — `forecast-*`,
`tokens-*` (plus `*-390-end` for the bottom of each at phone width),
`review-cue-*`, `sprint-forecast-*`, `rework-*`; light and dark, 1366 and 390;
none scrolls sideways.

**Gate** (foreground, after the last code change): `pnpm test` first run 1 —
`server/web`'s `github-confirm` browser fixture lacked `cue` (fixed,
0b39a366); second run **0**: cli 404 node:test tests (403 pass, 1 skipped —
the `LAIKA_PERF=1` timing check), web 2083/2083 node:test tests, server 2912
passed + 8 skipped of 2920 vitest cases in 142 files. `pnpm lint` 0. `pnpm
format` 0. No wall-clock assertion added: the sprint test counts draws and
simulations.

**Decisions**

- Coverage threshold 0.7 and weight-by-share (the R&D's §5.2) rather than a
  lower bar: with 17.8% attribution overall the forecast will stay off for
  most projects until LAI-780-style attribution improves — that is the honest
  state, not a defect.
- Build tokens are cut at the first finish's **UTC** day: the server has no
  zone for a collector's day. A finish near midnight may count that day either
  side; the Tokens section's rounds (reader's zone) can differ by a day.
- The token forecast lives on `TaskEstimateView`, not `TaskView.size`: fewer
  ripples into every task payload; the panel reads the estimate anyway.
- The claimant's estimate is its own append-only table, not a third
  `task_estimates.source`: a new source value is a CHECK change, i.e. a
  rebuild of an append-only table.
- The cue reads round 1 only: a later round is rework, which nothing
  forecasts. "Confirmed" = `round.ci` reported with nothing failed or pending.
- Rework is keyed to send-backs decided in the range; tokens after the
  sent-back round's day count, clamped to the range.
- Similar tasks for agents use an index over every finished task (not only
  ≥ 20, the forecast's threshold) so a young project's agents still get them.

**Deferred / not done**

- Per-agent-client accuracy of the claim estimate (k ≥ 3) — the column is
  kept; nothing reports it yet.
- Token forecast per agent client (the R&D's `c[agent client]` term).
- No plugin skill or Connect copy names `estimate` yet; only the tool's own
  description does.
- The board card for LAI-772 was not mirrored (`LAI-772` is not a board key;
  the MCP has no search), as for LAI-770/771.

## Migration regenerated on top of LAI-780 (2026-10-17T22:20Z)

On the orchestrator's word, after LAI-780 reached master: `git merge master`
(merge c38064d0). My `0038_token_forecasts` SQL, snapshot and journal entry
were deleted — master's `0038_tasks_external_ref_index`, its snapshot and the
journal taken as master has them, byte for byte — and the migration
regenerated with `pnpm db:generate --name token_forecasts`: now
**`0039_token_forecasts`, journal idx 38, `when` 1792275028091** (after
master's 1792269639241), its snapshot chained to master's 0038. The same four
statements as before; a second generate says *No schema changes*. Git's stat
shows it as a rename by content similarity; it was regenerated, not renamed.
The notes above that say 0038 are the record of the build and stand.

Two hand conflicts, both additive: `start_working` passes LAI-780's
`resolveTaskRef(db, task, actor)` and this task's `estimate`; SPEC §7.1 keeps
LAI-780's `create_task`/`update_task` rows (`external_ref`) and this task's
`start_working` row. The 0039 migration test now pins the database it upgrades
as master's `0038_tasks_external_ref_index`: populated there, then 0039
applied — every table keeps its root page and rows, `task_estimates` rows only
gain the two null columns, and the new table is append-only.

Gate after the merge (foreground): `pnpm test` first run 1 —
`test/tooling/build.test.ts` "keeps an idle connection open for 65 s" timed
out waiting for the built server's health under the parallel load; 15/15
alone. Second full run **0**: cli 410 node:test cases (409 pass, 1 skipped),
web 2093/2093 node:test cases, server 2958 passed + 8 skipped of 2966 vitest
cases in 144 files. `pnpm lint` 0. `pnpm format` 0.

## Review round 1 — CHANGES REQUIRED (B1), fixed (2026-10-18T03:37:40Z)

Commits bd42cbb3 (fix and tests), 7fb54c8e (LAI-782 filed). On top of
dcb370ee (migration 0039).

- **B1 — the Review cue's rules were not pinned.** New and reworked cases in
  `server/test/services/estimates.forecasts.test.ts`, "Review page cue":
  round 2 fast from the start (round 1 at +1 min, send-back at +2 min, round 2
  at +3 min, with a guard that 3 min is under 0.25× the p50); CI failed and CI
  pending, each still cued (with a guard that GitHub's line is on the round);
  0.3× and 0.2× of the round's own frozen p50 either side of the line. These
  pass on the code as it was — they pin it — and each mutation turns one red,
  run on the final formatted files, each restored by checksum from a trap:

  | mutation | where | red |
  | --- | --- | --- |
  | M1 `round?.number === 1 &&` → `round !== undefined &&` | `review.ts` | *says nothing on a later round, however fast* |
  | M2 failed or pending CI counted as confirmed | `review.ts` | *still says it when CI failed or is still running* |
  | M2a failed only / M2b pending only | `review.ts` | the same test, each |
  | M3 `FAST_FINISH_RATIO` 0.25 → 0.9 | `estimates.ts` | *draws the line at 0.25×* |
  | M4 the N2 change undone (blended p50) | `estimates.ts` | *measures against Laika's own p50* |

  Each run: 1 failed, 21 passed of 22; restored file green, 22/22.
- **N1.** `ClaimEstimateView` / web `ClaimEstimate` are `{ level, confidence }`;
  the row's time and client are kept (§4.34) and not served. `claimNote` no
  longer names the client. A key-set assertion was red before the change
  (`client_name`, `created_at` present). SPEC §6.4.
- **N2.** `fastFinishCues` measures against the frozen row's
  `factors_json.agent.model_p50_ms` when the row carries a blend, else its own
  p50, and reports that as `forecast_p50_ms`. Test: claimants' sizes with
  earned weight, a claim at XS, a finish at 0.2× Laika's own p50 that is
  ≥ 0.25× the blended one — red before (cue `null`), green after. SPEC §6.4.
- **N7.** The sprint range is trimmed evenly from both tails, not searched for
  the narrowest: `sprint-forecast-model.ts` comments and SPEC §6.4 now say so.
  The builder notes above that say "narrowest central range" are the record.
- **N3, N4, N5, N6, N8** filed as `.tasks/backlog/LAI-782-forecast-follow-ups.md`
  (`discovered-from: LAI-772`), the reviewer's items quoted. N4's lines are now
  `token-usage.ts:806`/`:853`.

**Gate** after the last edit (foreground): `pnpm test` **0** first run — cli 410
node:test cases (409 pass, 1 skipped), web 2093/2093, server 2961 passed + 8
skipped of 2969 vitest cases in 144 files; `pnpm lint` **0**; `pnpm format` **0**.
