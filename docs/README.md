# Laika — Full Roadmap

Seven phases from empty repo to public open source launch. Each phase has a goal,
its work items, and an **exit test** — a concrete thing that must be true before
moving on. Timelines assume 2 builder sessions + 1 PM session working in parallel
(the bootstrap workflow), part-time. Adjust freely; the order matters more than
the dates.

---

## Phase 1 — Walking skeleton (Week 1)

**Goal:** one thread through every layer, deployed for real, before any features.

- pnpm workspace, TypeScript strict, eslint/prettier, shared tsconfig
- Hono server boots, serves a hello React (Vite) page as static files
- SQLite via Drizzle: first migration runs automatically on boot, WAL mode on
- better-auth wired: email/password signup + login + session cookie works
- Dockerfile (multi-stage, multi-arch) + compose example; `docker run -v ./data:/data` works
- `/health` endpoint; structured logs to stdout; graceful shutdown
- GitHub Actions: lint + typecheck + build on every push

**Exit test:** a stranger can `docker run` the image on a clean VPS and log in.
*Skipping this phase's deploy step is the classic mistake — don't.*

---

## Phase 2 — The board (Weeks 2–3)

**Goal:** a real team can manage real work in it. Dogfooding starts HERE.

- Schema: orgs, users, projects, project_memberships, tasks, comments,
  activity (append-only), invites
- `can(actor, action, resource)` policy module — the ONLY authz path; unit-tested
  against the permission matrix in SPEC.md
- First-boot setup wizard (creates Owner + org); invite links that carry roles;
  role management UI (Owner/Admin/Member/Viewer)
- Task CRUD API with pagination + `updated_since`; dependencies incl. `discovered-from`
- Kanban + list views; task detail panel; comments; drag-and-drop status
- Activity feed per project; SSE for live board updates
- Nightly SQLite snapshot into `./data/backups`

**Exit test:** your own team moves off the `.tasks/` file system and runs the
Laika build *inside Laika* for one full week without rage-quitting back to files.

---

## Phase 3 — Agent access: MCP + tokens (Weeks 3–4)

**Goal:** Claude Code becomes a first-class board citizen.

- Personal access tokens: generate/scope/revoke UI; SHA-256 hashed at rest;
  shown once; per-token rate limiting
- MCP endpoint at `/mcp` (streamable HTTP, official SDK), tools:
  `list_ready_tasks`, `get_task_context`, `get_project_context`, `create_task`,
  `start_working`, `update_status`, `add_comment`, `finish_task`
- Every tool call attributed to the token's user; agent actions tagged in the
  activity feed ("Alex's agent")
- OpenAPI spec published from the route definitions (zod-openapi)

**Exit test:** in a fresh Claude Code session, `claude mcp add` the endpoint and
ask "what tasks are ready for me?" — correct answer, and the activity feed shows
the agent's read. Then build the rest of Laika *through* Laika.

---

## Phase 4 — The plugin (Week 5)

**Goal:** teammate onboarding drops to two commands.

- `plugin/` folder: `.claude-plugin/plugin.json`, bundled `.mcp.json`,
  `hooks/hooks.json` (session start/stop heartbeats), workflow skill,
  commands: `/laika:setup`, `/laika:status`, `/laika:tasks`, `/laika:standup`
- `/laika:setup` flow: asks board URL + token, saves to env/config
- Repo doubles as the marketplace; versioning + update flow documented
- Heartbeat API: `POST /api/v1/heartbeats` (metadata only: repo, branch, timestamp)

**Exit test:** a teammate who has never seen the project runs
`/plugin marketplace add` + `/plugin install` + `/laika:setup` and is fully
wired (MCP + heartbeats) in under 3 minutes, measured.

---

## Phase 5 — Presence & capacity (Week 6)

**Goal:** the board knows where everyone is working — the differentiator.

- Branch-name → task matching (`lai-42-slug`); unmatched repos surface as
  "unlisted work" with one-click "create as task/idea"
- GitHub webhook receiver (HMAC-verified): commits/branches update tasks,
  cover work done outside Claude Code
- Capacity view: per-person active sessions, in-progress tasks across projects,
  context-switch signal (heartbeats from multiple repos)
- Stale detection: in-progress tasks with no heartbeat/commit for N days get flagged
- Manager dashboard: read-only rollup for Viewers — progress, activity, agent log

**Exit test:** your manager (Viewer login) answers "what is each person working on
right now, and what's stalled?" from the dashboard alone, without asking anyone.

---

## Phase 6 — Meeting intelligence (Weeks 7–8)

**Goal:** meetings update the board instead of creating homework.

- `POST /webhooks/transcript` + manual paste box, per-project
- LLM reconciliation against the org-configured provider (Anthropic key or
  Ollama base URL, encrypted at rest): proposes NEW / CHANGED / DEAD tasks by
  diffing the transcript against open tasks — not just extraction
- Human review screen: approve/reject each proposal before anything applies;
  approved decisions append to the project context doc
- `get_project_context` MCP tool now returns decisions — every teammate's agent
  knows what the meeting decided

**Exit test:** after a real 30-minute team meeting, the review screen proposes at
least the changes you'd have made by hand, and applying them takes under 2 minutes.
*This phase is the most experimental — timebox it; ship behind a settings toggle.*

---

## Phase 7 — Hardening & public launch (Weeks 9–10)

**Goal:** strangers can adopt it without talking to you.

- Security pass: rate limits everywhere, CSRF, headers/CSP, dependency audit,
  restore-from-backup drill actually performed
- Litestream config documented (org-controlled S3/MinIO)
- Docs: README with the 8-step SETUP.md flow, screenshots, demo GIF,
  CONTRIBUTING.md, issue templates, LICENSE decision finalized (MIT vs AGPL)
- Release automation: tag → GitHub Action builds multi-arch image → publishes
- Seed the community: Show HN / r/selfhosted / X post, submit to
  awesome-selfhosted and the Claude Code plugin directories
- Tag **v0.1.0**

**Exit test:** one outside person installs from the README alone and files their
first issue instead of a "how do I even start" question.

---

## Post-v0.1 backlog (unordered — pull in as demand proves them)

- CLI (`laika status`, `laika start LAI-42`) from the OpenAPI spec
- Task templates; saved filters/views; simple sprint/cycle grouping
- Slack/Discord notifications; email digests
- SDK package generated from OpenAPI (`@laikahq/sdk`)
- Postgres option — only when a real org hits SQLite's ceiling
- SSO (OIDC) — only when a real org asks
- Multi-org — resist as long as humanly possible

## Standing rules across all phases

1. Deployment first, features second, AI features last.
2. Every phase ends with something your own team uses daily.
3. The `can()` module is the only door to data — no exceptions, ever.
4. No new dependency without a task file that argues for it.
5. If a phase slips, cut its scope, not its exit test.
