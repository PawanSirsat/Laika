# Laika — v1 Specification

Status: **draft, authoritative for M1–M7**
Owner: PM session
Last updated: 2026-08-24

Everything a builder session needs to agree on lives here. If the code and this
document disagree, that is a bug in one of them — raise it in your log and PM
will resolve it in `DECISIONS.md`. Do not silently diverge.

---

## 1. Product

Laika is a **self-hosted project board where humans and Claude Code agents work
from one source of truth.**

Today a team running coding agents keeps state in three incompatible places: a
SaaS tracker humans look at, the agent's own scratch notes, and whatever the
human remembers from the last session. Laika collapses those into one board that
both sides read and write through first-class interfaces — a web UI for people,
an MCP endpoint for agents — over identical data and identical permissions.

The design commitments that follow from that:

- **One deployment, one team.** Single organisation per install (§4.2). Not
  multi-tenant SaaS.
- **Agents are users, not integrations.** An agent acts as a real user via that
  user's personal access token. It cannot see or do anything the human whose
  token it holds cannot see or do.
- **Everything is an event.** The `activity` table is append-only and is the
  single feed behind the audit trail, presence, and the dashboard.
- **Your data stays yours.** Self-hosted, one SQLite file on a volume you own,
  **no telemetry of any kind** (§12.4).

### 1.1 Non-goals for v1

Not in scope, and no code should anticipate them: multi-org/multi-tenant
hosting, sprints or story points, time tracking and billing, Gantt or dependency
charts beyond the blocked/ready computation, mobile apps, SAML/SCIM, a public
plugin marketplace, and email as a *primary* interface (transactional invite
mail only).

---

## 2. Glossary

| Term | Meaning |
| --- | --- |
| **Org** | The single organisation this deployment serves. Owns projects, users, settings. |
| **Project** | A board. Has a key (`LAI`), members, and tasks numbered `LAI-1`, `LAI-2`, … |
| **Task** | The unit of work. What agents claim and humans triage. |
| **Actor** | Whoever a request is attributed to — always a user, whether they arrived via session cookie or token. |
| **Token** | A personal access token: hashed, scoped, revocable, belongs to exactly one user. |
| **Heartbeat** | A metadata-only ping saying "this user is working in this repo on this branch, now". |
| **Ready** | A task nobody is doing whose dependencies are all `done` — the thing an agent should pick up next. |

---

## 3. Roles and permissions

Four roles. Role is held **per project** in `project_memberships`; `Owner` and
`Admin` are additionally meaningful at org level.

- **Owner** — the person who installed Laika. Exactly one at a time,
  transferable. Everything Admin can do, plus: manage org settings, configure
  the LLM provider, transfer ownership, delete the org's data.
- **Admin** — creates projects, invites people, sets roles, deletes tasks and
  comments, manages webhooks. Cannot change org-level settings or billing-shaped
  things.
- **Member** — the working role. Creates and edits tasks, comments, claims work,
  mints **their own** MCP tokens. This is what agent sessions run as.
- **Viewer** — read-only. Sees the board and comments; writes nothing, holds no
  tokens.

### 3.1 Permission matrix

`✓` = allowed, `—` = denied, `self` = only the actor's own records,
`assigned` = only projects they are a member of.

| Action | Owner | Admin | Member | Viewer |
| --- | :---: | :---: | :---: | :---: |
| **Org** |
| View org settings | ✓ | ✓ | — | — |
| Edit org settings (name, signup mode) | ✓ | — | — | — |
| Configure LLM provider / API key | ✓ | — | — | — |
| Transfer ownership | ✓ | — | — | — |
| Delete org data | ✓ | — | — | — |
| **People** |
| Invite user | ✓ | ✓ | — | — |
| Set / change a user's role | ✓ | ✓ (not to Owner) | — | — |
| Deactivate user | ✓ | ✓ | — | — |
| View member list | ✓ | ✓ | ✓ | ✓ |
| **Projects** |
| Create project | ✓ | ✓ | — | — |
| Edit project settings | ✓ | ✓ | — | — |
| Archive / delete project | ✓ | ✓ | — | — |
| Add / remove project member | ✓ | ✓ | — | — |
| View project | ✓ | ✓ | assigned | assigned |
| **Tasks** |
| Create task | ✓ | ✓ | ✓ | — |
| Edit any task | ✓ | ✓ | ✓ | — |
| Change status / claim task | ✓ | ✓ | ✓ | — |
| Assign task to someone else | ✓ | ✓ | ✓ | — |
| Move task to `done` | ✓ | ✓ | ✓ | — |
| Delete task | ✓ | ✓ | — | — |
| View tasks | ✓ | ✓ | assigned | assigned |
| **Comments** |
| Add comment | ✓ | ✓ | ✓ | — |
| Edit comment | ✓ | ✓ | self | — |
| Delete comment | ✓ | ✓ | self | — |
| **Tokens** |
| Create own token | ✓ | ✓ | ✓ | — |
| List own tokens | ✓ | ✓ | ✓ | — |
| Revoke own token | ✓ | ✓ | ✓ | — |
| List / revoke **anyone's** token | ✓ | ✓ | — | — |
| **Activity & presence** |
| Send heartbeat | ✓ | ✓ | ✓ | — |
| View presence / capacity | ✓ | ✓ | ✓ | ✓ |
| View activity feed | ✓ | ✓ | assigned | assigned |
| Export audit log | ✓ | ✓ | — | — |
| **Webhooks** |
| Configure webhooks | ✓ | ✓ | — | — |
| Apply a transcript diff | ✓ | ✓ | ✓ | — |

### 3.2 The `can()` module is the only authority

There is exactly one implementation of this table, in `server/src/policy/`:

```ts
can(actor: Actor, action: Action, resource: Resource): boolean
```

Rules that are not negotiable:

1. **Every** endpoint calls `can()` before reading or writing — REST, MCP,
   webhook-triggered, cron-triggered, admin. No exceptions, no "internal" path.
2. `can()` is pure and synchronous. Everything it needs (actor, role, resource
   ownership) is loaded by the caller and passed in.
3. Deny by default. An unknown action or a missing membership is `false`.
4. Token scopes are applied **after** the role check and can only ever *narrow*
   it (§6.2). A token can never grant more than its user has.
5. It is unit-tested against the matrix above, case by case. That test file is
   the executable version of §3.1.

---

## 4. Data model

SQLite via Drizzle. Ids are ULIDs stored as `text` (sortable, no coordination).
Timestamps are `integer` unix-milliseconds UTC. Every table has `created_at`;
mutable tables have `updated_at`.

### 4.1 `users`

`id`, `email` (unique, citext-equivalent via lowercase-on-write), `name`,
`avatar_url`, `role` (org-level default role for new projects),
`status` (`active` | `invited` | `deactivated`), `created_at`, `updated_at`.

Credentials, sessions and verification records are owned by better-auth's own
tables (§10.3) — we do not hand-roll password storage.

### 4.2 `orgs`

`id`, `name`, `slug`, `owner_user_id`, `signup_mode` (`invite_only` | `open`,
default `invite_only` — see D-004), `llm_provider` (`anthropic` | `ollama` |
`none`), `llm_config_encrypted` (blob, §11), `created_at`, `updated_at`.

**Single-org deployment**: exactly one row, created on first-run setup. Every
other table still carries `org_id` where it matters so that the constraint is
data-level, not code-level, and so multi-org later is a migration rather than a
rewrite.

### 4.3 `projects`

`id`, `org_id`, `key` (short uppercase, unique per org — `LAI`), `name`,
`description`, `default_assignee_id`, `archived_at`, `created_at`, `updated_at`.

### 4.4 `project_memberships`

`id`, `project_id`, `user_id`, `role` (`owner` | `admin` | `member` | `viewer`),
`created_at`. Unique on (`project_id`, `user_id`). This is what `can()` reads.

### 4.5 `tasks`

`id`, `project_id`, `number` (per-project sequence → `LAI-42`), `title`, `body`
(markdown), `status`, `priority` (`p1` | `p2` | `p3`), `assignee_id`,
`creator_id`, `discovered_from_task_id` (nullable self-FK), `branch` (nullable,
last branch seen working on it), `external_ref` (nullable, e.g. GitHub PR),
`started_at`, `completed_at`, `created_at`, `updated_at`.

**Statuses**: `backlog` → `in_progress` → `review` → `done`, plus `cancelled`.
Transitions are validated server-side; any transition is legal except into or
out of `done`/`cancelled` without an explicit action, which is recorded in
activity.

**`ready` is derived, not stored.** A task is ready when
`status = 'backlog' AND assignee_id IS NULL AND every dependency is 'done'`.
This is what `list_ready_tasks` returns (§7.1) and what the board's "Ready"
column shows. Deriving it means it can never go stale.

**Dependencies** live in `task_dependencies` (`task_id`,
`depends_on_task_id`, `created_at`; unique pair). Cycles are rejected at write
time. `discovered-from` is a *different* relationship — provenance, not
blocking — and is a column on `tasks`, so a discovered task can be worked before
its parent finishes.

### 4.6 `comments`

`id`, `task_id`, `author_id`, `body` (markdown), `source` (`web` | `mcp` |
`webhook`), `edited_at`, `deleted_at` (soft), `created_at`, `updated_at`.

### 4.7 `activity` — append-only

`id`, `org_id`, `project_id`, `task_id` (nullable), `actor_user_id`,
`actor_token_id` (nullable — set when the action came through a token, which is
how we tell agent actions from human ones), `verb`, `subject_type`,
`subject_id`, `data` (JSON, the before/after delta), `created_at`.

**No updates, no deletes, ever** — enforced in the Drizzle layer and asserted in
tests. This one table feeds three consumers:

- **Audit** — who did what, when, as themselves or via which token.
- **Presence** — recent activity plus heartbeats (§8) answers "who is on what".
- **Dashboard** — throughput, cycle time, the standup view.

Verbs are a closed vocabulary: `task.created`, `task.updated`,
`task.status_changed`, `task.assigned`, `task.commented`, `task.dependency_added`,
`project.created`, `member.invited`, `member.role_changed`, `token.created`,
`token.revoked`, `webhook.received`, `diff.applied`.

### 4.8 `tokens`

`id`, `user_id`, `name`, `prefix` (first 8 chars, shown in UI so a token is
identifiable), `hash` (SHA-256 of the full secret — **the secret itself is never
stored and is shown exactly once, at creation**), `scopes` (JSON array),
`last_used_at`, `expires_at` (nullable), `revoked_at` (nullable), `created_at`.

### 4.9 `heartbeats`

`id`, `user_id`, `token_id`, `repo`, `branch`, `task_id` (nullable, resolved
from the branch name — §8.2), `at`, `created_at`. Metadata only: no file names,
no diffs, no prompt content (D-005). Rows older than 30 days are pruned by cron.

### 4.10 `invites`

`id`, `org_id`, `project_id` (nullable), `email`, `role`, `token_hash`,
`invited_by_user_id`, `accepted_at`, `expires_at`, `created_at`.

### 4.11 Indexes that must exist

`tasks(project_id, status)`, `tasks(assignee_id, status)`,
`tasks(project_id, updated_at)`, `task_dependencies(depends_on_task_id)`,
`comments(task_id, created_at)`, `activity(project_id, created_at)`,
`activity(task_id, created_at)`, `heartbeats(user_id, at)`,
`tokens(hash)` unique.

---

## 5. Task lifecycle

```
        create                claim / start_working          finish_task
backlog ───────▶ backlog ──────────────────────▶ in_progress ────────────▶ review
                (ready when deps done,                                       │
                 assignee null)                                              │ approve
                                                                             ▼
                                                                           done
```

- **Claiming is a compare-and-swap.** `start_working` sets `assignee_id` and
  `status = 'in_progress'` only if the task is still unassigned. A second
  claimant gets `409 Conflict` with the current assignee in the body — this is
  the API-level equivalent of the file-move lock the build sessions use.
- Moving to `review` requires the actor to be the assignee, an Admin, or Owner.
- Every transition writes exactly one `activity` row and emits one SSE event.
- A task may be reassigned while `in_progress`; that is an `task.assigned`
  activity, not a status change.

---

## 6. REST API

Base path **`/api/v1`**. JSON in, JSON out, UTF-8. Any non-`GET` requires
`Content-Type: application/json`.

### 6.1 Authentication

Two ways to be an actor, and they resolve to the same `Actor`:

1. **Session cookie** — better-auth, for the SPA. CSRF-protected;
   `SameSite=Lax`, `Secure` when not on localhost.
2. **Personal access token** — `Authorization: Bearer laika_pat_<secret>`.
   Looked up by SHA-256 hash, constant-time compared. Rejected if revoked or
   expired. Updates `last_used_at` (throttled to once a minute).

There is no third path. Webhooks authenticate by signature instead and act as a
system actor with a fixed, minimal capability set (§9).

### 6.2 Authorisation

Every handler resolves `Actor` → loads the resource → calls
`can(actor, action, resource)` → 403 if false. Token scopes narrow afterwards:

| Scope | Grants |
| --- | --- |
| `tasks:read` | read tasks, comments, projects |
| `tasks:write` | create/update tasks, claim, transition |
| `comments:write` | add comments |
| `presence:write` | send heartbeats |
| `projects:read` | project + member metadata |

A token issued to a Viewer with `tasks:write` still cannot write — role first,
scope second, both must allow.

### 6.3 Conventions

- **Pagination**: `?limit=` (default 50, max 200) and `?cursor=` (opaque,
  encodes `(sort_key, id)`). Responses:
  `{ "data": [...], "next_cursor": "..." | null }`. No offset paging.
- **`updated_since`**: every list endpoint accepts `?updated_since=<ms>` and
  returns only rows changed at or after it, **including soft-deletes as
  tombstones** (`{ "id": "...", "deleted": true }`). This is how an agent or a
  reconnecting SPA catches up cheaply without a full refetch.
- **Errors**: `{ "error": { "code": "forbidden", "message": "...",
  "details": {...} } }` with codes `bad_request`, `unauthorized`, `forbidden`,
  `not_found`, `conflict`, `unprocessable`, `rate_limited`, `internal`.
- **Idempotency**: `POST` accepts `Idempotency-Key`; replays within 24h return
  the original response.
- **Rate limits**: per token, in-process token bucket — 600 req/min general,
  60/min writes, 30/min heartbeats. `429` with `Retry-After`.
- **Validation**: zod schemas at the boundary; the inferred types are the
  handler's argument types.

### 6.4 Endpoints

```
GET    /api/v1/me
GET    /api/v1/org                          PATCH /api/v1/org            (Owner)
GET    /api/v1/users                        POST  /api/v1/users/invite   (Admin+)
PATCH  /api/v1/users/:id/role               (Admin+)
GET    /api/v1/projects                     POST  /api/v1/projects       (Admin+)
GET    /api/v1/projects/:id                 PATCH /api/v1/projects/:id   (Admin+)
GET    /api/v1/projects/:id/members         POST  /api/v1/projects/:id/members
DELETE /api/v1/projects/:id/members/:userId
GET    /api/v1/projects/:id/tasks           ?status=&assignee=&priority=&ready=&updated_since=&cursor=
POST   /api/v1/projects/:id/tasks
GET    /api/v1/tasks/:id                    PATCH /api/v1/tasks/:id
POST   /api/v1/tasks/:id/claim              POST  /api/v1/tasks/:id/status
POST   /api/v1/tasks/:id/dependencies       DELETE /api/v1/tasks/:id/dependencies/:depId
GET    /api/v1/tasks/:id/comments           POST  /api/v1/tasks/:id/comments
PATCH  /api/v1/comments/:id                 DELETE /api/v1/comments/:id
GET    /api/v1/activity                     ?project_id=&task_id=&since=&cursor=
GET    /api/v1/tokens                       POST  /api/v1/tokens         DELETE /api/v1/tokens/:id
POST   /api/v1/heartbeats
GET    /api/v1/presence                     GET   /api/v1/capacity
GET    /api/v1/events                       (SSE, §10.5)
GET    /api/v1/health
```

---

## 7. MCP endpoint

Served by the same process at **`/mcp`** (Streamable HTTP transport).
Authentication is a personal access token as `Bearer`, identical to §6.1.

**Every tool acts as the token's user.** There is no service account, no
elevated mode, no bypass. A tool call runs the same `can()` check the equivalent
REST endpoint runs, writes the same `activity` row (with `actor_token_id` set,
which is how the UI labels an action as coming from an agent), and emits the
same SSE event. If an agent can do something in Laika, it is because its human
could.

### 7.1 Tools

| Tool | Input | Returns | Notes |
| --- | --- | --- | --- |
| `list_ready_tasks` | `project?`, `area?`, `limit?` | ready tasks, priority then age | The derived `ready` of §4.5. This is the "what should I do next" call. |
| `get_task_context` | `task_id` | task, deps + their statuses, comments, recent activity, related branch, `discovered_from` chain | One call, everything needed to start. Deliberately fat — round-trips are expensive for an agent. |
| `get_project_context` | `project_id` | project, members + roles, conventions, in-flight work, board counts | Orientation at session start. |
| `create_task` | `project_id`, `title`, `body`, `priority?`, `area?`, `depends_on?`, `discovered_from?` | the created task | The `discovered_from` path — how an agent files what it finds without doing it. |
| `start_working` | `task_id`, `branch?` | task, or `409` with current assignee | Compare-and-swap claim (§5). |
| `update_status` | `task_id`, `status`, `note?` | task | Validated transition; `note` becomes an activity detail. |
| `add_comment` | `task_id`, `body` | comment | Rendered in the UI as from the human, badged as agent-authored. |
| `finish_task` | `task_id`, `summary`, `checklist?` | task | → `review`, posts `summary` as a comment, ticks criteria. |

### 7.2 Tool contract

- Inputs are zod schemas exported as JSON Schema; unknown fields are rejected,
  not ignored.
- Errors come back as MCP tool errors with the §6.3 `code` intact, so the agent
  can branch on `conflict` versus `forbidden` rather than parse prose.
- Read tools never mutate — including `last_used_at`, which is throttled.
- Responses are compact markdown-in-text plus a structured payload: readable when
  the model reasons over it, parseable when it doesn't.

---

## 8. Presence and capacity

### 8.1 Heartbeats

`POST /api/v1/heartbeats` with `{ repo, branch, timestamp }`. Sent by the Claude
Code plugin (session start, then every ~60s while active) and optionally by a
human's editor integration. Requires `presence:write`.

**Metadata only.** Repository name, branch name, timestamp. Never file paths,
diffs, prompts, or transcript content (D-005). This is the one place where a
tempting feature would cost us the trust the product is built on.

### 8.2 Branch names carry task ids

Convention: **`lai-<number>-<slug>`** — `lai-42-add-task-crud`. The server
parses the leading `<project-key>-<number>` case-insensitively, resolves it to a
task, and stores `task_id` on the heartbeat and `branch` on the task. Anything
unparseable is kept as a plain branch string; it degrades, it never errors.

### 8.3 Derived views

- **Presence** (`GET /api/v1/presence`) — users with a heartbeat in the last 5
  minutes, with their repo, branch, and resolved task. "Who is working right
  now."
- **Capacity** (`GET /api/v1/capacity`) — per user: in-progress task count,
  whether they are currently heartbeating, oldest in-progress task age, tasks in
  review awaiting them. Answers "who can take the next thing" and "what is stuck
  with nobody on it".

Both are computed from `heartbeats` + `tasks` at request time. No separate
presence store to fall out of sync.

---

## 9. Webhooks

Mounted at `/webhooks/*`, outside `/api/v1`, no user session.

### 9.1 `POST /webhooks/github`

HMAC-SHA256 verified against the configured secret (`X-Hub-Signature-256`),
constant-time compared, **before the body is parsed**. Unverified requests get
`401` and are logged as `webhook.received` with `verified: false`.

Handled events: `push` (branch → task, activity entry), `pull_request`
(opened → link PR to task and move `in_progress`; merged → move to `review`),
`issue_comment` (mirror to task comments). Everything else is acknowledged and
ignored. Delivery ids are deduplicated for 24h.

### 9.2 `POST /webhooks/transcript`

The meeting-notes path: an external transcript source posts a transcript, the
configured LLM provider (§11) turns it into a **proposed diff** against the
board — tasks to create, statuses to change, comments to add.

**The diff is never applied automatically.** It is stored as a pending proposal
and surfaced on a human review screen where every line can be accepted or
rejected individually. Applying is `can()`-checked as if the reviewing human had
made each change by hand, and lands as normal activity with `source: webhook`.
Proposals expire unreviewed after 7 days.

This is the one place an LLM writes to the board, and it is gated by a human.
That gate is a product requirement, not a v1 shortcut.

---

## 10. Stack and runtime

### 10.1 One process

A single Node process (Node 22 LTS) serving the API, the MCP endpoint, the
webhooks, the SSE stream, the cron jobs, and the static SPA. No queue, no worker,
no Redis, no sidecar. If something needs a background job, it runs in-process
(§10.6).

### 10.2 HTTP — Hono

Hono on `@hono/node-server`. Middleware order is fixed:
`requestId → logger → cors → bodyLimit → auth → rateLimit → route → errorHandler`.
Routes are grouped modules mounted onto the app; handlers stay thin, logic lives
in service modules that take an `Actor`.

### 10.3 Persistence — SQLite + Drizzle

`better-sqlite3` in **WAL** mode, `foreign_keys=ON`, `busy_timeout=5000`,
`synchronous=NORMAL`. Database file at `/data/laika.db` (§10.7).

**All access through Drizzle** — schema, queries, and migrations. Migrations are
generated files committed to the repo and applied on boot, forward-only. Writes
that touch more than one table run in a transaction. No raw SQL in handlers; the
only exceptions are the `PRAGMA`s above, at startup.

Auth is **better-auth** with the Drizzle adapter: email+password and invite
acceptance for v1, its tables alongside ours in the same database.

### 10.4 Frontend — React + Vite

React 19 + TypeScript + Vite, built to static assets and served by the same Node
process from `server/public/`. SPA fallback to `index.html` for non-`/api`,
non-`/mcp`, non-`/webhooks` routes. It talks to the same public `/api/v1` — no
private endpoints, which keeps the API honest.

### 10.5 Live updates — SSE

`GET /api/v1/events` (see D-003). One long-lived `text/event-stream` per client,
filtered server-side to the projects that actor may see. Events mirror activity
verbs (§4.7). Each carries a monotonic `id`; on reconnect the client sends
`Last-Event-ID` and, if the gap is too large, falls back to
`?updated_since=` (§6.3). Heartbeat comment every 25s to survive proxies.

### 10.6 Scheduled work — in-process cron

A single interval-driven scheduler in the same process: prune heartbeats older
than 30 days, expire stale invites and transcript proposals, recompute dashboard
rollups, vacuum weekly. Jobs are idempotent and log to `activity` only when they
change something.

### 10.7 Deployment — one image

One Docker image, multi-stage (build SPA → build server → slim runtime).
One writable volume at **`/data`** holding `laika.db`, WAL files, and uploads —
back that up and you have backed up Laika. Config via environment; first-run
setup wizard creates the org, the Owner, and the first project. TLS is somebody
else's job — a `Caddyfile.example` ships in `docker/`.

---

## 11. LLM provider

Org-configured, Owner-only, one provider at a time:

- **Anthropic** — API key, stored encrypted.
- **Ollama** — base URL, for fully local deployments.
- **None** — the default. Laika is fully functional without an LLM; only the
  transcript-diff feature (§9.2) is unavailable.

Secrets are encrypted at rest with AES-256-GCM using a key derived from a
required `LAIKA_SECRET` environment variable. Ciphertext lives in
`orgs.llm_config_encrypted`; plaintext is never logged, never returned by the
API (the UI sees `{ configured: true, provider, key_last4 }`), and never written
to `activity`.

---

## 12. Cross-cutting

### 12.1 Security

Argon2id passwords (better-auth default), tokens hashed SHA-256 and shown once,
constant-time comparison for tokens and HMACs, CSRF on cookie-auth mutations,
`bodyLimit` on every route, zod validation at every boundary, security headers
(HSTS, `X-Content-Type-Options`, CSP with no inline script), no secrets in logs
or error responses.

### 12.2 Errors and logging

Structured JSON logs to stdout: `request_id`, `actor_id`, `token_id`, method,
path, status, duration. `request_id` is returned on 5xx so a user can quote it.
Unhandled errors return `internal` with no detail; the detail goes to the log.

### 12.3 Testing

Vitest. Unit tests for `can()` against the §3.1 matrix, service-level tests
against a real in-memory SQLite with migrations applied, HTTP-level tests
through Hono's test client, and MCP tool tests that assert a tool and its REST
twin produce identical activity rows.

### 12.4 Privacy

**No telemetry. No analytics. No phone-home. No usage beacons.** Not
opt-out — absent. The only outbound network calls Laika ever makes are to the
org's configured LLM provider (§11) and to a webhook source it was configured to
talk to. Any task proposing otherwise gets rejected at review.

---

## 13. Open questions

Tracked here until decided; each becomes a `DECISIONS.md` entry.

1. Does `Member` need "assign to someone else", or should that be Admin-only on
   larger teams? (Currently allowed — optimising for small trusting teams.)
2. Task templates per project — M2 or later?
3. Do we need a `blocked` status distinct from "has unfinished dependencies"?
   (Currently derived, not stored.)
4. Attachments/uploads on tasks — deferred; the `/data` volume anticipates them.
5. Multiple LLM providers configured at once (one for transcripts, one for
   summaries) — deferred past v1.
