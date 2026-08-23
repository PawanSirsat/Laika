# Laika — Feature list

Status: **captured 2026-08-24.** Owner: PM session.

The complete picture of what Laika is meant to be, with an honest status on each
item. `VISION.md` says why these exist; `SPEC.md` specifies the phase 1–3 ones in
technical detail; `ROADMAP.md` sequences them.

**Legend**

| Tag | Meaning |
| --- | --- |
| `[built]` | Merged and accepted into `master` — a task file for it sits in `.tasks/done/` |
| `[planned phase N]` | Committed to, scheduled for milestone MN, specified to the depth that milestone needs |
| `[idea]` | We want it, we have not decided the shape. **Not** in the spec. Do not build. |

**Phases map 1:1 to the milestones in `ROADMAP.md`** — phase 1 = M1, and so on.

> **Reality check, 2026-08-24:** nothing is `[built]` yet. Repo tooling (LAI-001)
> and the plugin skeleton (LAI-012) are in `.tasks/review/` awaiting PM. This
> table describes the intended product, not a shipped one.

---

## The four wedge features

The bundle Laika is betting on (`VISION.md` §4). Everything else supports these.

| Feature | Status | Where specified |
| --- | --- | --- |
| Board and local agent share one source of truth | `[planned phase 3]` | SPEC §7 |
| Live presence and capacity from heartbeats | `[planned phase 5]` | SPEC §9 |
| Meetings diff against the board and update it | `[planned phase 6]` | SPEC §10.2 |
| Shared per-project context injected into every agent | `[planned phase 3]` | SPEC §7.3 |

---

## Phase 1 — Foundation

| Feature | Status | Notes |
| --- | --- | --- |
| pnpm workspace, TypeScript strict, lint, test runner | `[planned phase 1]` | LAI-001, in review |
| Hono server, health endpoint, static SPA serving | `[planned phase 1]` | LAI-002 |
| SQLite (WAL) + Drizzle schema and migrations | `[planned phase 1]` | LAI-003 · SPEC §4 |
| **Roles: owner / admin / member / viewer** | `[planned phase 1]` | The `can()` policy module — LAI-004 · SPEC §3. Two-level: org role + project role (D-006) |
| better-auth sessions, invite-only signup | `[planned phase 1]` | LAI-005 · SPEC §6.1, D-004 |
| API conventions: pagination, `updated_since`, errors, rate limits | `[planned phase 1]` | LAI-006 · SPEC §6.3 |
| React + Vite SPA shell | `[planned phase 1]` | LAI-007 |
| Single Docker image, `/data` volume | `[planned phase 1]` | LAI-008 · SPEC §11.7, D-002 |
| First-run setup wizard | `[planned phase 1]` | LAI-009 |

## Phase 2 — The board humans use

| Feature | Status | Notes |
| --- | --- | --- |
| Projects CRUD, membership management | `[planned phase 2]` | LAI-010 · SPEC §6.4 |
| Tasks CRUD, statuses, priorities, assignees | `[planned phase 2]` | LAI-011 · SPEC §4.5, §5 |
| Task dependencies + `ready` computation | `[planned phase 2]` | SPEC §4.6 — `ready` is derived, never stored |
| `discovered-from` provenance | `[planned phase 2]` | SPEC §4.6 — provenance, **not** a blocker |
| **Kanban board view** | `[planned phase 2]` | SPEC §11.4.1 — columns by status, drag to transition |
| **List view** | `[planned phase 2]` | SPEC §11.4.1 — same data, sortable/filterable table |
| Task detail view, comments | `[planned phase 2]` | SPEC §4.7 |
| Activity feed / audit trail | `[planned phase 2]` | SPEC §4.8 — append-only, feeds everything else |
| Invites: send, accept, roles | `[planned phase 2]` | SPEC §4.11 |
| SSE live updates | `[planned phase 2]` | SPEC §11.5, D-003 |

## Phase 3 — Agents become first-class

| Feature | Status | Notes |
| --- | --- | --- |
| **MCP server at `/mcp`** | `[planned phase 3]` | SPEC §7 — Streamable HTTP, token auth |
| **MCP tools** (10) | `[planned phase 3]` | `list_projects`, `list_ready_tasks`, `get_task_context`, `get_project_context`, `create_task`, `start_working`, `update_status`, `add_comment`, `finish_task`, `log_unlisted_work` — SPEC §7.1 |
| **Personal access tokens** | `[planned phase 3]` | Hashed, shown once, scoped `full`/`read_only`, project-restrictable, revocable — SPEC §4.9 |
| **Shared project context doc** | `[planned phase 3]` | `projects.context_md`, served by `get_project_context` — SPEC §7.3. Wedge feature (d) |
| Agent-authored actions badged in the UI | `[planned phase 3]` | `activity.actor_kind = 'agent'` — SPEC §4.8 |
| MCP ↔ REST parity tests | `[planned phase 3]` | SPEC §13.3 — identical activity rows |
| OpenAPI served at `/api/openapi.json` | `[planned phase 3]` | SPEC §6.3 |

## Phase 4 — Plugin and CLI

Outline only. Expand just in time.

| Feature | Status | Notes |
| --- | --- | --- |
| Claude Code plugin: manifest, `.mcp.json` | `[planned phase 4]` | LAI-012, in review |
| Heartbeat hooks (SessionStart / Stop / throttled) | `[planned phase 4]` | SPEC §8 — fail-silent `\|\| true` is mandatory |
| Plugin skills teaching the task protocol | `[planned phase 4]` | claim-before-code, finish→review, `discovered_from` |
| Plugin commands: setup, status, tasks, standup | `[planned phase 4]` | SPEC §8 |
| **`laika` npm CLI** | `[planned phase 4]` | `npx laika init` — authenticate, mint token, write local config |

## Phase 5 — Presence, capacity, and the manager view

Outline only. Expand just in time.

| Feature | Status | Notes |
| --- | --- | --- |
| **Presence heartbeats** | `[planned phase 5]` | `POST /heartbeats {repo, branch}` — metadata only, D-005. Wedge feature (b) |
| Branch → task resolution | `[planned phase 5]` | Server-side, `lai-42-slug` — SPEC §9.2 |
| **Capacity view** | `[planned phase 5]` | Per user: active sessions, in-progress tasks, last seen, review queue — SPEC §9.3 |
| **Stale detection** | `[planned phase 5]` | Cron flags `in_progress` with no heartbeat/commit for 3 days — SPEC §11.6 |
| **Unlisted-work detection** | `[planned phase 5]` | `log_unlisted_work` records work outside any project — SPEC §7.1 |
| **One-click "make this a task"** | `[planned phase 5]` | UI turning an unlisted-work entry into a real task. **Shape not fully specified** |
| **Manager dashboard** | `[planned phase 5]` | Throughput, cycle time, stuck work, standup view — from `activity`. **Metrics not finalised** |
| Heartbeat retention pruning (30d) | `[planned phase 5]` | SPEC §11.6 |

## Phase 6 — Meetings and git

Outline only. Expand just in time.

| Feature | Status | Notes |
| --- | --- | --- |
| Org-configured LLM provider | `[planned phase 6]` | Anthropic key or OpenAI-compatible base URL, encrypted at rest — SPEC §12, D-009 |
| **Meeting transcript diff** | `[planned phase 6]` | Transcript → strict-JSON proposals with quotes — SPEC §10.2. Wedge feature (c) |
| **Meeting review screen** | `[planned phase 6]` | Line-by-line accept/reject; nothing applies unreviewed — SPEC §10.2 |
| **Git webhook** | `[planned phase 6]` | `/webhooks/github`, HMAC-verified; push/PR/comment → board — SPEC §10.1 |

## Phase 7 — Release

Outline only. Expand just in time.

| Feature | Status | Notes |
| --- | --- | --- |
| Install / upgrade / backup / restore docs | `[planned phase 7]` | |
| Nightly snapshots, restore drill | `[planned phase 7]` | SPEC §11.6 |
| Security headers, rate limit hardening | `[planned phase 7]` | SPEC §13.1 |
| Published Docker image, versioning, CHANGELOG | `[planned phase 7]` | |
| Accessibility and empty-state pass | `[planned phase 7]` | |

---

## Ideas — wanted, not yet shaped

**Do not build these. They are not in `SPEC.md` and have no task files.** Each
needs a design pass and a decision entry before it becomes a phase.

| Idea | What it would be | Open questions |
| --- | --- | --- |
| **Laika Assistant chat panel** | An in-app chat over the board's own data — "what changed this week", "what is Ana blocked on", "draft a task from this paragraph" | Read-only or can it mutate? If it mutates, does it go through the same propose→accept gate as meeting diffs (D-007 says it must)? Which provider — the org's configured one? What is the context window strategy over a large activity log? |
| **SDK** | A typed client library for the REST + MCP API, so teams can build their own automations | Which language first — TypeScript, presumably? Generated from the OpenAPI spec, or hand-written? Is it public/npm, or internal? Does it get its own auth story or reuse personal tokens? |

---

## Deliberately not features

From `SPEC.md` §1.1 and `VISION.md` §6, restated so nobody re-proposes them:

Multi-org / multi-tenant hosting · Postgres · WebSockets · custom fields · file
uploads · a plugin system of our own · mobile apps · SSO/SAML/SCIM · sprints,
story points, epics · time tracking and billing · Gantt charts · **telemetry of
any kind** · anything that reads file contents, diffs, or prompts from a session.
