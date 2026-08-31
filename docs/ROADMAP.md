# Laika — Roadmap

Owner: CHIEF session. Last updated: 2026-08-24.

Milestones are sequential and each one ends in something demonstrable. A
milestone is complete when every task carrying its label sits in `.tasks/done/`
and its exit criterion below is true. Task ids are seeded as we go — only M1 and
the front of M2 are broken down today (§ backlog), the rest are shaped, not
scheduled.

---

## M1 — Walking skeleton
**Goal: the thing boots, a human can log in, and it runs in Docker.**

- pnpm workspaces, TypeScript strict, ESLint + Prettier, Vitest wired
- Frontend shell — Vite scaffold, design tokens and both themes, sidebar and
  routing, empty/loading/error states, form primitives (LAI-017…LAI-021).
  **API-independent — runs in parallel with the server work** (D-016)
- SPA wired to the API: sign-in, `/me`, protected routes (LAI-007)
- Drizzle + SQLite (WAL) with the first migration and a real schema
- better-auth: sign-up (invite-only), sign-in, session, `GET /api/v1/me`
- `can()` policy module with the §3.1 matrix and its unit tests
- Dockerfile + compose, `/data` volume, first-run wizard stub

**Exit:** `docker compose up` → open the browser → create the Owner account →
see an empty authenticated shell. Tasks: **LAI-001 … LAI-009**.

---

## M2 — Board CRUD, wizard, invites
**Goal: a human team can actually use it, without agents.**

- Projects: create, list, settings; project key and per-project task numbering
- Tasks: CRUD, statuses, priorities, assignee, dependencies, `discovered-from`
- Comments, activity feed writing on every mutation
- Board UI: columns, drag between statuses, task detail, filters
- First-run wizard: org → Owner → first project → first task
- Invites: send, accept, roles; member management screen
- SSE stream so two open tabs stay in sync
- **Sprints**: `sprints` table, `tasks.sprint_id`, CRUD, one active per project,
  no overlaps; Sprints screen (D-013 — story points remain excluded)

**Exit:** two humans on two machines run the same board and never refresh.
Tasks: **LAI-010, LAI-011** seeded; remainder groomed at M1 review.

---

## M2.5 — Timeline
**Goal: the Gantt-style view, for the cost of a rendering pass.**

- `GET /projects/:slug/timeline` — sprints with their ranges and their tasks
- Timeline screen: one bar per sprint, tasks as contents, unscheduled tray
- Drag a sprint edge to reschedule (`PATCH /sprints/:id`), rejected on overlap

**Exit:** a manager reads the quarter off one screen and reschedules a sprint by
dragging it.

Numbered 2.5 rather than inserted as a new M3 so that M3–M7 keep their numbers —
`FEATURES.md` and the task files cite them (D-011). Depends entirely on M2's
sprints; **tasks never get their own dates** (D-014).

---

## M3 — MCP server and tokens
**Goal: an agent is a first-class member of the board.**

- Personal access tokens: mint, scope, hash, revoke, `last_used_at`, UI
  (LAI-402, LAI-403, LAI-410)
- `/mcp` Streamable HTTP transport, token auth, actor resolution (LAI-406)
- The **ten** tools of SPEC §7.1, each `can()`-checked and activity-writing —
  four read (LAI-407), six write (LAI-408). This line said *eight* until
  2026-08-31; §7.1 has listed ten since `log_unlisted_work` was added, and §7.2
  says nine of them have REST twins. Ten is the number.
- The two surfaces the tools read and write that had no REST route at all:
  `GET`/`PATCH /projects/:slug/context` (LAI-404, feeding `get_project_context`)
  and the unlisted-work queue (LAI-405, LAI-413, receiving `log_unlisted_work`)
- Agent-authored actions badged in the UI (LAI-411)
- The project context document gets somewhere to be written (LAI-412)
- Parity tests: MCP tool and REST twin produce identical activity rows (LAI-409)

**Exit:** Claude Code, pointed at `/mcp` with a token, picks up a ready task,
claims it, comments, and moves it to review — visible live in a human's browser.

---

## M4 — Claude Code plugin
**Goal: zero-config for the agent side.**

- **`POST /api/v1/heartbeats`** — the write path only: accept `{repo, branch}`,
  token auth, `202`, store the row (**LAI-417**). Moved here from M5 (D-023) so
  the hooks have something to talk to and M4 can be verified end to end.
  **Branch → task resolution (§9.2) and retention pruning stay in M5** — this
  line said "branch detection" until 2026-08-31, which read as M4 scope and is
  not
- Hooks: heartbeat on session start, on stop, and on a 5-minute throttle
  (**LAI-418**). Every hook fails silent — §8's `|| true` is mandatory
- Plugin manifest and `.mcp.json` pointing at a deployment, loading cleanly when
  unconfigured (**LAI-419**)
- Slash commands `/laika:setup`, `/laika:status`, `/laika:tasks`,
  `/laika:standup` (**LAI-420**). `/laika:status` shows "own capacity", which is
  an M5 endpoint — the task says to ship honestly against what exists or defer it
- The skill teaching claim-before-code, `finish_task` → `review`,
  `discovered_from` and `log_unlisted_work` (**LAI-421**)
- `npx laika init` CLI: authenticate, mint a token, write local config
  (**LAI-422**)

**One open question inside M4**: `/laika:setup` (§8) and `npx laika init`
(this list) both "write local config", and the spec does not say whether they are
one mechanism with two front doors. Named in both tasks as CHIEF's to settle;
whichever builder reaches it first raises it rather than implementing a reading
(the LAI-139 rule).

**Exit:** a new repo goes from nothing to an agent working the board in one
command, **and a heartbeat from that agent is visible in the database**. Seeded early: **LAI-012** (plugin skeleton — no dependencies, so
SHELL can build it during M1).

---

## M5 — Presence and capacity
**Goal: see who — human or agent — is on what, right now.**

- Branch → task resolution, retention pruning (the write path itself ships in
  M4 — D-023)
- Presence view (live) and capacity view (in-progress + heartbeat + staleness)
- Dashboard rollups from `activity`: throughput, cycle time, stuck work
- Standup view: done since yesterday, in progress by whom, blocked, next up

**Exit:** the capacity screen answers "who takes the next task" without asking.

---

## M6 — Meeting diff
**Goal: a conversation becomes board changes, with a human in the loop.**

- Org LLM provider config (Anthropic key or Ollama URL), encrypted at rest
- `POST /webhooks/transcript`: transcript → proposed diff, stored pending
- Human review screen: accept/reject per line, `can()`-checked on apply
- `POST /webhooks/github`: HMAC verification, push/PR/comment handling
- **Laika Assistant** chat panel — scope decided first (SPEC §14, q9: read-only
  vs can-mutate, provider strategy, context scope), then specified, then built

**Exit:** paste a standup transcript, review the proposal, apply it, and the
board reflects the meeting.

---

## M7 — Release polish
**Goal: someone who is not us can run it.**

- Docs: install, upgrade, backup/restore, token setup, plugin install
- Migration safety on boot, backup command, restore drill
- Rate limiting, security headers, error budgets, load sanity check
- Published Docker image + versioning, CHANGELOG, `laika` on npm
- Accessibility and empty-state pass over the SPA

**Exit:** a stranger follows the README on a fresh VPS and is running Laika in
under ten minutes.

---

## Sequencing notes

**Nothing is cut** (D-015). Every feature in `FEATURES.md` has a milestone; the
answer to "are we building X" is a date, never "no". The guard against that
becoming a wish list is that each milestone has an exit test — work that does not
serve the current exit test waits, however scheduled it is.

- M1 is the only milestone where CORE and SHELL are near-independent —
  SHELL has LAI-008 (docker) and LAI-012 (plugin skeleton) to work while
  CORE builds the server.
- M3 depends on the whole of M2's task model; do not start MCP tools against a
  schema that is still moving.
- M6 is the only milestone with an external LLM dependency and can slip without
  blocking M7.
