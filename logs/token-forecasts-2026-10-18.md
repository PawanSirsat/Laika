# token-forecasts — 2026-10-18

Owner-direct build of LAI-772 (size and forecasts, phase 2) through the
orchestrator, temporary worktree `Laika-token-forecasts/`, branch
`build-token-forecasts` from `master` 90ed0358. Not pushed, not merged.

## 2026-10-17T21:32:00Z — LAI-772

**What changed**
- server/src/services/token-model.ts (new, pure) — token calibration on size weight, attributed actuals only (coverage ≥ 0.7, weighted), time-ordered back-test vs the weighted median, conformal p50/p80, median fallback
- server/src/services/sprint-forecast-model.ts (new, pure) — seeded Monte Carlo, bounded draws, narrowest central ≥ 85% range
- server/src/services/sprint-forecast.ts (new) — `GET /sprints/:id/forecast`: 42-day throughput by size weight, order review → in progress → to do → backlog, cached per sprint
- server/src/services/estimate-model.ts — `buildSimilarIndex`/`findSimilar` at any size, `scoreAgentEstimates`, `blendAgent`, the `agent` factor
- server/src/services/estimates.ts — composite model (fit + tokens + claimants' score + lookup), `tokenActuals`, token p50/p80 on each row and in `moved`, the claim blend, `recordClaimEstimate`, estimate view fields (tokens, actual_tokens, claim_estimate, scope_grew, split), accuracy `tokens`/`agent`, `similarFinishedTasks`, `fastFinishCues`
- server/src/services/tasks.ts — `claimTask(…, estimate)`: stored best effort after the activity row, then freeze or refresh
- server/src/services/review.ts — `cue` on each queue item (round 1, CI not confirmed)
- server/src/services/token-usage.ts — `rework[]` on `GET /usage`, per project, nobody named
- server/src/db/schema.ts, enums.ts, migrate.ts, migrations/0038_token_forecasts.sql + meta — `task_claim_estimates` (append-only triggers), `task_estimates.tokens_p50/p80`; additive
- server/src/http/routes/tasks.ts, sprints.ts; server/src/mcp/write-tools.ts, read-tools.ts — claim body / `start_working` `estimate`, the forecast route, `get_task_context` `similar` + new Size lines
- server/web/src/api/{estimates,review,sprints,usage}.ts — mirrored types and wording
- server/web/src/routes/screens/task/{ForecastSection,TokensSection}.tsx + css, review/ReviewScreen.tsx + css, sprints/SprintCard.tsx + css, usage/UsageScreen.tsx + css — the screens
- docs/SPEC.md §1.1, §4.32, §4.34 (new), §6.4, §7.1, §11.4
- tests: server token-model, sprint-forecast-model, sprint-forecast, estimates.forecasts, token-usage.rework, estimate-model additions, migrate (0038 case; the 0037 case now stops at its own migration), schema table list, MCP read/write, routes estimates/sprints/review/usage; web api estimates/review/sprints/usage/view-type-drift, browser task-size/task-tokens/review/usage/github-confirm + sprint-forecast (new)
- .tasks/review/LAI-772-token-forecasts-and-review-cues.md

**Decisions**
- Learn tokens only from tasks with ≥ 70% attributed coverage, weighted by it — rather than all attributed rows: a mostly-unattributed task is a floor that would teach "tasks are cheap".
- The claim estimate is its own append-only table — rather than a third `task_estimates.source`, which is a CHECK change and so a rebuild of an append-only table.
- Agent weight is inverse variance against the model, capped at 0.9, and 0 until ≥ 10 scored tasks beat the median — Laika's model always keeps a share.
- The token forecast sits on `TaskEstimateView`, not `TaskView.size` — fewer ripples through every task payload.
- Build tokens cut at the first finish's UTC day — the server has no collector zone; documented in SPEC.
- The review cue reads round 1 only; rework is not forecast.
- Similar tasks for agents from an index over every finished task, not only once the forecast's 20 exist.

**Discovered**
- Only 12 of 116 attributed task keys on this machine reach 70% coverage (all ONR, one day); 0 LAIKA. The time-ordered token back-test has n = 2 (×1.31 vs ×1.46); leave-one-out with hindsight ×2.77 vs ×2.70 — size does not beat the median on that set. Attribution (LAI-780) is the bottleneck, not the model.
- zsh does not word-split an unquoted `$F`: a `git stash push -- $F` chain failed at its first step and stashed nothing (verified, nothing lost); redone in `bash -c` with copies restored by checksum.
- The throwaway server warms static files at boot: a rebuilt bundle needs a restart before screenshots.
- A browser fixture without a new required field crashes the screen (`github-confirm` lacked `cue`); the full gate caught it on the first run.
- LAI-780's `0038_tasks_external_ref_index` reaches master first (orchestrator): this branch must regenerate its 0038 on top after merging master — not filed, it is the documented README procedure.

**State**
In .tasks/review/. Gate: `pnpm test` 0, `pnpm lint` 0, `pnpm format` 0. Not pushed; migration to be regenerated after LAI-780 lands, on the orchestrator's word.
