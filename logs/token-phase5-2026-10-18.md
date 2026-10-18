# token-phase5 — 2026-10-18

Owner-direct build of LAI-773 (token usage, phase 3) with LAI-776 folded in,
through the orchestrator. Temporary worktree `Laika-token-phase5/`, branch
`LAI-773-token-phase5` from `master` 4d48470d. Not pushed, not merged.
Board cards LAIKA-578 (LAI-773) and LAIKA-580 (LAI-776) moved to In progress
at the start.

## 2026-10-18T05:25:00Z — LAI-773, LAI-776

**What changed**
- server/src/db/schema.ts, enums.ts, migrations/0040_token_phase5.sql + meta — nine tables (`org_model_prices`, `token_budgets`, `token_alerts`, `token_alert_dismissals`, `token_session_days`, `token_telemetry_series`, `token_session_skips`, `plan_limits`, `token_arrivals`) and a partial index on `token_usage_days`; additive, generated with the LAI-778 wrapper
- server/src/services/token-telemetry.ts (new) — OTLP/HTTP JSON parsing of `claude_code.token.usage` / `claude_code.cost.usage`, one-way session keys, cumulative and delta idempotency, first-sight baseline, the session-matched gap written as collector `telemetry`
- server/src/services/model-prices.ts, org-model-prices.ts (new) — the dated price table with sources (2026-10-18), org overrides, `UsageCost` (no price ≠ $0, inferred prices named)
- server/src/services/token-budgets.ts (new) — budgets per task (frozen p80 default) / sprint / project-month, soft 80%/100% alerts raised once, the runaway check, my alerts, admin counts a day late
- server/src/services/plan-limit.ts (new) — arrivals in 5-minute buckets, the developer's own forecast, zoned day/week windows
- server/src/services/token-usage.ts — report `sessions`/`excluded`, gap recompute in a savepoint, arrivals and alerts after the write (best effort); cost/cache/accepted/telemetry/budgets/runaway on `GET /usage`; cost on person and task usage; budget and runaway on a task
- server/src/services/local-activity.ts, estimates.ts — telemetry rows excluded from `usage_days_elsewhere` and from the 70% coverage the token model learns by; delete-history deletes the new rows
- server/src/http/routes/otlp.ts, token-budgets.ts, me-usage.ts (new); orgs.ts — `/otlp/v1/metrics` (+ logs/traces 404), budgets, `/me/token-alerts`, `/me/plan-limit`, `/org/model-prices`
- server/src/policy/actions.ts, can.ts — `org.model_prices.set`, `token_alerts.own`, `plan_limit.own`, `budget.set`, all session only
- server/src/http/rate-limit.ts, middleware/rate-limit.ts, auth/tokens.ts, app.ts, jobs/jobs.ts — OTLP bucket, OTLP not presence, routes, loggers, retention
- server/test/** — services (telemetry 21 cases, budgets 20, plan-limit 11, prices 7, org prices 3, usage +5: four index-plan cases and one work count), routes (otlp 7, budgets 5, me-usage 4), policy, migrate 0040, schema/drift tests, `helpers/work.ts`
- cli/src/activity-usage.ts, activity-hooks.ts, activity.ts, activity-store.ts; plugin/scripts/laika-activity-hook; READMEs; cli tests — the CLI fork's: `turn-end` on Claude Code's `Stop`, day-partitioned records (format 4), `sessions`/`excluded`, `laika activity otel`
- server/web/src/** and server/web/test/** — the web fork's: Usage cost/cache/accepted/budgets/runaway/alerts/plan limit, Tokens section cost/budget/runaway, Organisation model prices, Connect OTLP block, sidebar badge; drift pairs
- docs/SPEC.md §3.1, §3.2, §4.13, §4.33, §4.35–§4.43, §6.3, §6.4, §11.4.2, §11.6, §13.4; docs/DECISIONS.md D-087
- .tasks/review/LAI-773-…md, .tasks/review/LAI-776-…md

**Decisions**
- Telemetry matched to the files **per session by a one-way key** — rather than per day, which under-counts whenever some sessions export and others do not; the unplaced file tokens are subtracted so a missing session list can only under-fill, never double count.
- The collector also sends `excluded` keys (automated or out of scope), amending D-086 item 1 for the key alone — without it an orchestrator's telemetry, or an out-of-scope repo's, would count in full.
- A cumulative series first seen > 5 min after it began is a **baseline** — its first value can hold pre-consent tokens; the CLI fork raised it.
- p95 derived from the frozen p50/p80 as the log-normal the model calibrates — rather than a new `tokens_p95` column, which no frozen estimate would have.
- "Heartbeat progress" = a session **arriving** on the task (first heartbeat after five minutes' silence); a steady stream is presence, not progress — otherwise a looping agent with the plugin never alerts.
- Runaway window 60 min from this repo's commit gaps (581 gaps: p90 31, p95 47 min), six sync intervals; only the first build (no round), since the forecast is for the build.
- **No comment and no activity row** for alerts: no honest author, a feed row would show a runaway to the project first, a verb is an `activity` rebuild (D-087 item 4).
- Prices, budgets, alerts and plan limit are **session only** — an agent's token must not move the figures that watch it.
- Plan kinds are labels; no token figure is claimed for any plan (Anthropic states sessions and weeks).
- Rows telemetry adds live in `token_usage_days` under collector `telemetry` — every existing read sees them; the three places that mean "a machine" exclude it.
- Prices endpoint `GET /org/model-prices`, not a field on `GET /org` — keeps `OrgView` and its drift pair unchanged.
- Work split three ways (main: server + docs; forks: cli/plugin and web), forks forbidden to commit; everything committed by path from here.

**Discovered**
- `zsh` again: `prettier --write $FILES` passed one argument; rerun with `xargs` (CLAUDE.md's word-splitting note, met in practice).
- The app scrolls inside its own container, so Playwright's `fullPage` captured only the first screen; the screenshot script grows the viewport to the scroll height.
- A tsx script outside the worktree cannot resolve `drizzle-orm`: imported by absolute path.
- First full gate: `migrate.test.ts` (0029, 5 s) and `build.test.ts` (built server health) failed under load, 24/24 and 15/15 alone — LAI-768 family; second full gate exit 0. Not filed (LAI-768 open).
- Existing collectors get the `Stop` hook only after `laika activity on` is run again — documented in cli/README.md, not automated.
- Not confirmed in Claude Code's docs: whether `session.id` is a data-point or resource attribute (both read). OpenAI's page lists no `gpt-5.x-codex` except 5.3; three rows inferred, one model unpriced.

**Gate** (after the last code edit, each to its own file, nothing piped)
- First run: `pnpm test` 1 (server 2 load timeouts, above; cli 425 + 2 skipped of 427 cases, web 2133/2133).
- Final run: `pnpm test` **0** — server 3067 passed + 8 skipped of 3075 cases (151 files + 1 skipped), web 2133/2133 cases, cli 425 passed + 2 skipped of 427 cases; `pnpm lint` **0**; `pnpm format` **0**.
- Measured (LAI-776, real `~/.claude/projects`, 779 transcripts, 2.12 GB, read-only mirror, usage fields only): new bytes in one transcript 100–111 ms → 28.3–37.6 ms; nothing new 10–12 ms; full first read 4.05–4.17 s.
- Screenshots: /tmp/laika-token-phase5-shots/ (20), throwaway server on 37773, its data deleted.

**State**
Both in .tasks/review/. Not pushed. Board cards commented; never moved to Done.

## 2026-10-18T06:25:00Z — LAI-773, LAI-776 (review round 1)

**What changed**
- server/src/services/token-telemetry.ts — `recomputeGap` matches each session over every day it has rows on, then floors and spreads (B1); `zoneFor` reads the stated zone first; `storeZone`; points held to today − 31 … today + 1 in that zone, `msOf` capped at `Date`'s range (`day_out_of_range`)
- server/src/db/schema.ts, migrations/0040_token_phase5.sql + meta — `token_usage_zones`, `token_session_days(user_id, session_key)`; 0040 regenerated (unshipped), still additive
- server/src/services/token-usage.ts — `telemetryMatch`: zone, sessions, excluded and the gap in one best-effort savepoint; B2's `peopleIn`, `foldAgents`, `foldModels`, the accepted-cost fold, `MIN_AGENT_PEOPLE` exported
- server/src/http/routes/otlp.ts — actor and consent in a middleware ahead of `bodyLimit`
- server/src/services/local-activity.ts — delete-history removes the stored zone
- server/src/services/model-prices.ts — Sonnet 5.5 and Haiku 5.5 rows quoted from the pricing page
- server/test/** — telemetry (B1 repros, B1 shapes, the window), usage (B2 ×5, delete-history zone), budgets (59/61 min, 79/80%), prices, OTLP door, schema/migrate/drift lists
- server/web/src/api/usage.ts, UsageScreen.tsx, AcceptedCostCard.tsx; web tests — `few_people`, *Other (fewer than 3 people)*, no price off `unpriced_models`
- cli/src/activity-sync.ts, activity-usage.ts, activity.ts, README; cli tests — `telemetryToBoard`; `excluded` only with telemetry to this board
- docs/SPEC.md §4.13, §4.38, §4.44, §6.4; docs/DECISIONS.md D-087 items 2 and 7
- .tasks/backlog/LAI-783-token-phase5-review-follow-ups.md (filed); both task files' round-1 notes

**Decisions**
- The gap is matched per session over its whole span, then floored — rather than over adjacent days only, since a session can run for days and the span costs the same handful of indexed reads.
- The telemetry zone is stored per person from each usage report (`token_usage_zones`), rather than read off `local_activity_days`, which a person sharing usage but no snapshot has none of.
- The fold uses `usage.read_people`, so an owner's **token** is folded too, as `by_developer` is withheld from it; the owner's wording was "admins and owners see everything, as now", and as now a token sees no person.
- The folded row is keyed and labelled by `few_people`, not by `agent: "other"`, which the `other` agent kind already uses.
- The CLI decides "telemetry configured" from settings.json `env` or the environment with the endpoint under this board's `/api/v1/otlp/`, rather than from the variables alone: telemetry pointed at another collector brings Laika nothing to drop.

**Discovered**
- The first mutation run left one survivor: removing the span's neighbour days passed the late-files test, because that test listed its session and the key reached the next day alone. Added the unlisted case (818d70d8); now `600 to be 300`.
- A telemetry flip alone does not make the CLI resend: the keys go with the next report, which a session started with telemetry on produces. The test states that; left as is.
- Folding hides which agent, not how much: a fold holding one person's one agent is still that person's figure. Recorded under D-087's "What this does not decide", not changed.
- Three things the review did not hold the task for → LAI-783 filed (discovered-from: LAI-773).

**Gate** (after the last code edit, 818d70d8; each to its own file, nothing piped)
- `pnpm test` **0** — server 3088 passed + 8 skipped of 3096 cases (151 files + 1 skipped), cli 429 passed + 2 skipped of 431 cases, web 2136/2136 cases; `pnpm lint` **0**; `pnpm format` **0**. No LAI-768 timeout.
- Mutations: 27, all red after 818d70d8 (26 on the first run, one survivor, then its test); the B1 repros against 9c17e9c9's code: 6 of 6 red.

**State**
Both still in .tasks/review/. Not pushed. Never moved to Done.
