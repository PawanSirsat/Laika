---
id: LAI-769
title: 'Token usage, phase 1: the collector counts tokens from agents'' session files; a Usage page and profile card show them (cli/ + plugin/ + server/ + server/web/ + docs/)'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

The owner wants to know how many tokens the team's agents consume: for the
whole organisation, per project (split by developer), per person, per agent
and per model. When this is finished, `laika activity sync` also sends daily
token totals read from each agent's own session files, under D-079's two
switches, and a new **Usage** page plus a profile card show them. Task
attribution is phase 2 (LAI-770); this phase stores a task key when the
collector already has one and shows "unattributed" otherwise. D-084 is the
contract. Research with measurements: ~/Documents/laika-strategy/token-usage/REPORT.md.

## Acceptance criteria

- [ ] **Collector reads usage numbers only** from Claude Code transcripts (`~/.claude/projects/**/*.jsonl`), Codex rollouts (`~/.codex/sessions`) and Gemini CLI sessions, incrementally by byte offset per file. A test proves no prompt/reply text, path, repo, branch or session id is in what is sent.
- [ ] **Counted once:** Claude Code usage deduplicated by message id across all files, largest value per field; Codex as the day's difference of its cumulative total. Tests reproduce the 2.1× over-count of naive summing and show it gone.
- [ ] **Cheap:** an incremental sync with nothing new costs under 50 ms on a machine with ~800 transcripts (measured and reported); the one-time first read is allowed to take seconds and runs in the background, never in a hook's time limit.
- [ ] **Payload:** per day × agent × model × task key-or-null: input, output, cache-write, cache-read. Totals replace the day's previous totals (idempotent). Sent through the existing sync and its rate limits; only when both switches are on; *delete my history* deletes token rows.
- [ ] **30-day backfill** of totals (unattributed) on `laika activity on` / `backfill`, asking first as LAI-757 does.
- [ ] **Server:** one rollup table (migration **0035**, additive only) with indexes so each of org total, project total, project by developer, person, agent and model over a date range is one indexed query. Measured with 300 users × 400 days: each Usage query under 50 ms; payload upsert under 20 ms.
- [ ] **Usage page** in the sidebar (org) with a space selector: headline tokens excluding cache reads (cache reads shown separately), trend chart, **by developer**, by agent, by model, top tasks (where a key exists), and the unattributed share. Light and dark, laptop and phone.
- [ ] **Profile card:** tokens per week, top agents and models, share attributed.
- [ ] **Who sees what (D-084 item 7):** owners/admins everyone; a developer their own; members project and task totals only, never per person — enforced by the server, tested for a member and for a token caller.
- [ ] **Labels:** figures say *at least* (transcripts miss background calls). Agents with no token source (Copilot CLI, Cursor, Windsurf) show "no token data".
- [ ] SPEC sections for the endpoint, table and screen; D-084 already written.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 (known load timeouts LAI-768 rerun alone and reported).

## Notes / context

- Read D-078, D-079, D-080 and D-084 first. The collector is `cli/src/activity*` (LAI-752/757); the server half is `PUT /api/v1/me/local-activity` and the activity rollups (LAI-751).
- Migration number **0035** is reserved for this task; LAI-771 (running in parallel) takes 0036 and regenerates if needed.
- No new dependencies.
- Made on the owner's direct instruction (single agent, one PR's worth of work across areas).
