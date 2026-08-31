---
id: LAI-417
title: POST /api/v1/heartbeats — the write path
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-09-01T09:45:00Z
---

## Goal

M4's hooks need something to talk to. D-023 moved this endpoint out of M5 for
exactly that reason: **the write path ships in M4 so the milestone can be
verified end to end**, and the reading of it — presence, capacity — stays in M5.

`POST /api/v1/heartbeats`, body `{ repo, branch }`, **token auth only**, `202`
(SPEC §9.1, §6.4). The `heartbeats` table already exists (§4.10).

## Deliberately not in this task

- **Branch → task resolution (§9.2) is M5.** `matched_task_id` stays `null`.
  Store `branch` as the plain string it arrives as.
- **Retention pruning is M5.** No cron here.
- **`GET /presence` and `GET /capacity` are M5.** Nothing reads these rows yet,
  and that is fine — the exit criterion is that a heartbeat *is visible in the
  database*, not on a screen.

If you find yourself wanting any of the three, you are past the boundary. Say so
in your log rather than widening.

## Acceptance criteria

- [ ] `POST /api/v1/heartbeats` accepts `{ repo, branch }`, returns **`202`**, and
      writes exactly one row with `user_id`, `token_id`, `repo`, `branch`,
      `created_at`. `matched_task_id` is `null`.
- [ ] **Token auth only.** A session cookie is refused. §9.1 says "token auth
      only" and §8's hook sends a `Bearer` — a browser has no reason to post one.
      A test proves a valid cookie does **not** work.
- [ ] **Every endpoint calls `can()`** (CLAUDE.md §5). If §3.1 has no cell that
      fits, **stop and file against `docs`** — do not reuse a plausible-sounding
      action, and do not skip it. This is the LAI-408 situation and it may recur;
      the answer there was a new §3.1 row written by CHIEF.
- [ ] **Metadata only, and nothing more (D-005, §9.1, §13.4).** `repo` and
      `branch` are strings with a sane length bound. Any other field in the body
      is **refused**, not ignored — `.strict()`, the LAI-407 lesson. A test posts
      `{ repo, branch, diff: "..." }` and expects `422`.
- [ ] Writes **no `activity` row.** A heartbeat is presence, not an audited
      action, and one row per five minutes per agent would drown the feed. Say so
      in a comment; a reader will otherwise assume it was forgotten.
- [ ] `LIMITS.heartbeat` is the policy that applies — `classify` already routes
      `heartbeat:` paths (LAI-138). Confirm it fires here rather than assuming;
      an unbounded presence endpoint is the one most likely to be hammered.
- [ ] Tests: happy path `202`, cookie refused, unknown field `422`, oversize
      `repo`/`branch` refused, rate limit applies, row shape correct.
- [ ] `pnpm format`, `pnpm format:fix`, `pnpm lint`, `pnpm typecheck`,
      `pnpm test` all green.

## Notes

No new dependencies.

**Read §4.10 and §13.4 before writing the handler.** *"This is the one place
where a tempting feature would cost the trust the product is built on."* If a
field looks useful and is not `repo`, `branch` or a timestamp, the answer is no.
