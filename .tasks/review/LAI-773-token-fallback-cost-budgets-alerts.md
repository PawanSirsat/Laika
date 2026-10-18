---
id: LAI-773
title: 'Token usage, phase 3: OpenTelemetry fallback, API-equivalent cost, budgets with soft alerts, runaway-agent alert, plan-limit forecast for the developer'
area: server
assignee: owner-direct
priority: p2
depends-on: [LAI-772]
discovered-from:
status: review
started: 2026-10-18T03:46:13Z
finished: 2026-10-18T05:16:18Z
---

## Goal

Close the gaps left by session files and turn usage into something teams can
act on. D-084 items 9–10; research: ~/Documents/laika-strategy/token-usage/REPORT.md and ~/Documents/laika-strategy/task-estimation/REPORT.md §9.

## Acceptance criteria

- [x] Metrics-only OTLP receiver for Claude Code telemetry (`claude_code.token.usage`) as a fallback source, deduplicated against session-file counts; no outbound calls.
- [x] API-equivalent cost from a dated per-model price table in code, admin-editable, labelled "API-equivalent, not your bill"; cost per accepted task by project and agent.
- [x] Budgets per task (p80), sprint or project with soft alerts at 80% and 100%.
- [x] Runaway-agent alert: a claimed task past p95 tokens with no commit or heartbeat progress notifies the assignee first.
- [x] Plan-limit forecast visible only to the developer.
- [x] Cache efficiency per project.
- [x] Root gate exit 0 on all three.

## Notes / context

- Owner-direct. No new dependencies without naming them here first.

## Builder notes (at review)

Owner-direct, through the orchestrator. Worktree `Laika-token-phase5`, branch
`LAI-773-token-phase5` from `master` 4d48470d. Not pushed. LAI-776 folded into
the same branch (the runaway alert needs tokens before a session ends).
Migration **0040_token_phase5**, generated with the LAI-778 wrapper:
nine `CREATE TABLE`s and one partial index on `token_usage_days` — nothing
rebuilt, altered or dropped (`migrate.test.ts` proves every table keeps its
root page and rows). Decision **D-087**. No new dependency.

**Against each criterion**

1. **OTLP fallback** — `POST /api/v1/otlp/v1/metrics`, OTLP/HTTP JSON only
   (protobuf → `422 protobuf_not_supported` naming the setting), the
   developer's own bearer token, both D-084 switches asked before the body,
   `read_only` refused. Reads `claude_code.token.usage` and
   `claude_code.cost.usage` only; every other metric and attribute dropped
   unread; `/v1/logs` and `/v1/traces` 404 unread; not presence (D-081 path
   excluded); own rate bucket (12/min, burst 60). **Dedupe by one-way session
   key** (`sha256("laika-session:"+id)[:16]`): the collector sends per-day
   per-session file totals and the keys it excluded (automated, out of scope);
   the gap `max(0, Σ max(0, tel − files) − unplaced)` per person/day/model is
   written as collector `telemetry` and recomputed whenever either side moves.
   Cumulative and delta both idempotent; a cumulative series first seen > 5
   min after it began is a baseline (pre-consent tokens never counted). No
   outbound call. Env vars printed by Connect and `laika activity otel`;
   names/attributes checked against code.claude.com/docs/en/monitoring-usage
   on 2026-10-18; **not confirmed**: whether `session.id` is on the point or
   the resource (both read).
2. **API-equivalent cost** — `services/model-prices.ts`: dated table
   (2026-10-18), each row's source URL; Anthropic rows read off the pricing
   page; OpenAI rows for listed models; `gpt-5.2-codex`, `gpt-5.1-codex`,
   `gpt-5.1-codex-max` **inferred** (not on OpenAI's page) and marked;
   `gpt-5.1-codex-mini` and Gemini models have **no price**; Haiku 5.5 at its
   ≤100k-prompt rate (a floor). Cache writes at the 5-minute rate (floor).
   Admin overrides (`org_model_prices`, session only). Unknown model → no
   price, never 0. Shown as "API-equivalent, not your bill" on Usage (org,
   space, per developer for admins, by model), on the task's Tokens section,
   and cost per accepted task by project and by agent (agents with < 3 people
   withheld, D-085 item 8).
3. **Budgets** — per task (frozen p80 by default, overridable), per sprint
   (its tasks on its days), per project per calendar month; set by a lead on a
   session (§3.2 `budget.set`); soft alerts at 80% and 100%, once each per
   budget figure; nothing ever refused. In-app only: Usage banner + sidebar
   badge (`GET /me/token-alerts`), the Tokens section bar, the Usage budgets
   card. **No comment and no activity row** (D-087 item 4: no honest author,
   a feed row would show a runaway alert to the whole project first, a new
   verb is an `activity` rebuild).
4. **Runaway** — in progress, assigned, first build (no round), tokens past
   the frozen p95 (`p50·(p80/p50)^(z95/z80)`), nothing landed for 60 min (no
   claim, no `webhook.commit`, no pushed-commit key from the assignee, no
   session *arriving* on the task — a heartbeat is presence, not progress).
   Window measured: 581 intra-sitting commit gaps in this repo, p90 31 min,
   p95 47 min; 60 = six sync intervals. One per stall, to the assignee alone;
   admins see a per-project count once an alert is 24 h old.
5. **Plan-limit forecast** — `GET/PUT/DELETE /me/plan-limit`, session only,
   the caller's own; no admin row, no token, no endpoint naming anyone else.
   Plan is a label (no vendor token figure claimed; Anthropic's 5-hour
   session + weekly limit cited); the developer's own number; rate from
   arrivals in 5-minute buckets (8 days); "estimate" in the payload and UI.
6. **Cache efficiency** — `cache` and `cache_by_project` on `GET /usage`:
   cache-read share of input-side tokens and the saving at list price.
7. Root gate — see the gate section below.

**LAI-776** — see its own task file.

**Commits** on `LAI-773-token-phase5`: 31cb7a88 (claim), ba984849 (migration
0040), 9b2e9821 (server), f6802de1 (cli + plugin, LAI-776), 231eb603 (web),
045236d6 (SPEC + D-087).

**Tests first, mutation-proved.** Server: 10 mutations on the new rules —
unplaced tokens not subtracted, a delta repeat taken, excluded keys kept, a
late cumulative series counted, the quiet window ignored, every heartbeat
taken as progress, alerts not best effort, a runaway shown to a non-holder
(survived first — the reassignment case had no test; added, then red), the
panel's runaway to anyone, the plan limit without `can()` — all 10 red,
restored by checksum. CLI: 10 mutations (hook and usage module), all caught.
Work counted, not timed (LAI-779): a report's statements equal with 3 or 25
days of telemetry history; the Usage page's statements equal for 3 and 30
people; every new Usage query a SEARCH on an index (EXPLAIN).

**Screenshots** in `/tmp/laika-token-phase5-shots/` (20: light and dark at
1366 and 390 — Usage with cost, cache, budgets and runaway counts as an
owner; the task Tokens section with cost and a lead-set budget; the runaway
alert on the assignee's task; the assignee's Usage with alerts and the
plan-limit forecast; the Organisation price table), from a throwaway
instance on port 37773 with its own data dir, seeded through the services,
stopped and deleted after. No horizontal overflow at 390.

**Root gate** — run after the last code edit; results in the log entry
(`logs/token-phase5-2026-10-18.md`). First run: `pnpm test` 1 — server's
only failures `migrate.test.ts` (0029 case, 5 s timeout) and `build.test.ts`
(built server not healthy in time), the LAI-768 load family; alone, 24/24
and 15/15. cli 425 + 2 skipped of 427, web 2133/2133.

**Not verified / open**
- Whether Claude Code puts `session.id` on the data point or the resource
  (both read); no live Claude Code export was pointed at a Laika here.
- Inferred prices: `gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max`;
  no price for `gpt-5.1-codex-mini` or any Gemini model.
- "A task comment or activity row": none is written, by D-087 item 4 — an
  owner may prefer a system comment for budget alerts; that is a decision.
- Existing collectors get the `Stop` hook only after `laika activity on` is
  run again.
