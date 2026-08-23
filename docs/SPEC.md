# Laika — SPEC v1 (implementation-grade)

This document is the source of truth. Builders implement exactly this; deviations
require a PM-approved task that updates this file first.

Product: self-hosted board where humans and Claude Code agents share one source of
truth. Single Node process (Hono), SQLite (WAL) via Drizzle, better-auth, React+Vite
SPA served statically, MCP at /mcp, SSE for live updates, one Docker image, all data
in /data.

---

## 1. Data model (Drizzle / SQLite)

Conventions: ids are `text` ULIDs. Timestamps are `integer` unix ms named
`created_at` / `updated_at`. Soft-delete only where noted. All FKs indexed.

### users
| field | type | notes |
|---|---|---|
| id | text pk | ulid |
| email | text unique | lowercase |
| name | text | |
| password_hash | text | managed by better-auth |
| org_role | text | 'owner' \| 'admin' \| 'member' \| 'viewer' |
| avatar_color | text | derived from id, no uploads v1 |
| is_active | integer | 0 = deactivated (kept for history) |

### org (exactly one row — single-org deployment)
| field | type | notes |
|---|---|---|
| id | text pk | |
| name | text | |
| ai_provider | text | 'anthropic' \| 'openai_compatible' \| null |
| ai_base_url | text | for ollama/vllm |
| ai_api_key_enc | text | AES-256-GCM, key derived from SERVER_SECRET |
| smtp_json_enc | text | nullable |
| invite_only | integer | default 1 |

### projects
| field | type |
|---|---|
| id, name, slug (unique), description | |
| visibility | 'public' (org members may self-join as member) \| 'private' |
| context_md | text — the shared project context doc served to agents |
| archived_at | nullable |

### project_memberships
| field | notes |
|---|---|
| project_id + user_id | unique pair |
| role | 'lead' \| 'member' \| 'viewer' |
Constraint (enforced in code): a user with org_role 'viewer' may only hold
project role 'viewer'. No escalation via project assignment.

### tasks
| field | notes |
|---|---|
| id | ulid |
| number | integer, per-project sequence → display key "LAI-42" (prefix = upper slug) |
| project_id, title, description_md | |
| status | 'backlog' \| 'todo' \| 'in_progress' \| 'review' \| 'done' \| 'cancelled' |
| assignee_id | nullable FK users |
| priority | 'p1' \| 'p2' \| 'p3' (default p2) |
| discovered_from | nullable FK tasks |
| stale_flagged_at | nullable, set by cron |
| created_by, created_via | created_via: 'web' \| 'mcp' \| 'api' \| 'webhook' \| 'meeting' |

### task_dependencies
task_id, depends_on_task_id (unique pair). Cycle check in code on insert.

### comments
id, task_id, author_id, body_md, created_via (same enum), created_at.

### activity  (append-only; NO update/delete endpoints exist)
| field | notes |
|---|---|
| id | ulid |
| project_id, task_id (nullable), actor_id | |
| actor_kind | 'user' \| 'agent' (agent = token-authenticated request) |
| type | 'task.created' \| 'task.status_changed' \| 'task.assigned' \| 'comment.added' \| 'member.added' \| 'heartbeat.session' \| 'webhook.commit' \| 'meeting.applied' \| ... |
| payload_json | diff/details |
This table feeds: audit log, activity feed, presence, dashboard, SSE events.

### tokens
| field | notes |
|---|---|
| id, user_id, name | |
| token_hash | sha256 of full token; token shown once, format `lai_<40 base62>` |
| scope | 'full' \| 'read_only' |
| project_ids_json | null = all the user's projects |
| last_used_at, expires_at (nullable), revoked_at (nullable) | |

### heartbeats
| field | notes |
|---|---|
| id, user_id | |
| repo, branch | text — METADATA ONLY, never content |
| matched_task_id | nullable, resolved from branch pattern `[a-z]+-(\d+)` vs project prefix |
| created_at | |
Retention: cron deletes rows older than 30 days.

### invites
id, email (nullable for link invites), org_role, project_id (nullable),
project_role (nullable), token_hash, created_by, expires_at, accepted_by.

### sessions — managed by better-auth.

---

## 2. Permission matrix

Org roles gate global actions; project roles gate project actions. `can()` resolves:
org owner/admin bypass project membership checks (they hold implicit 'lead' on all
projects). A project 'lead' has all member rights plus the ✓L items.

| Action | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| Delete org / transfer ownership | ✓ | ✗ | ✗ | ✗ |
| Org settings (AI, SMTP) | ✓ | ✓ | ✗ | ✗ |
| Create/archive project | ✓ | ✓ | ✗ | ✗ |
| Invite users / change org roles | ✓ | ✓ | ✗ | ✗ |
| Join public project (as member) | ✓ | ✓ | ✓ | ✗ (viewer only) |
| Generate own tokens | ✓ | ✓ | ✓ | ✓ (read_only scope forced) |

| Project action (requires membership unless org admin+) | Lead | Member | Viewer |
|---|---|---|---|
| Manage project members / edit context_md | ✓ | ✗ | ✗ |
| Create/edit/move any task, comment | ✓ | ✓ | ✗ |
| Delete a comment | own + any (L) | own | ✗ |
| Cancel/delete task | ✓ | own-created | ✗ |
| Read tasks, activity, capacity for this project | ✓ | ✓ | ✓ |

Implementation: single module `server/src/policy/can.ts` exporting
`can(actor, action, resource): boolean` + `assertCan(...)` (throws 403).
Every route and every MCP tool calls assertCan. Unit tests enumerate this matrix.

---

## 3. REST API (/api/v1)

Auth: session cookie (web) OR `Authorization: Bearer lai_...` (tokens).
All list endpoints: `?limit=` (default 50, max 200), `?cursor=`, `?updated_since=` (ms).
Errors: `{ error: { code, message } }`; 401/403/404/409/422/429.
Rate limit: 120 req/min per token, 600 per session; 429 with Retry-After.

Endpoints (method path — notes):
- POST /auth/* — better-auth mounted routes
- GET  /setup/status ; POST /setup — first-boot wizard, disabled after org exists
- GET/PATCH /org — settings (admin+); ai_api_key write-only
- GET/POST /invites ; POST /invites/accept
- GET /users ; PATCH /users/:id (role changes admin+; deactivate)
- GET/POST /projects ; GET/PATCH /projects/:slug ; POST /projects/:slug/join
- GET/POST/PATCH/DELETE /projects/:slug/members
- GET/PATCH /projects/:slug/context — the context doc
- GET/POST /projects/:slug/tasks ; GET/PATCH /tasks/:id
  - PATCH accepts partial {title, description_md, status, assignee_id, priority}
  - status change writes activity 'task.status_changed' with {from, to}
- POST /tasks/:id/comments ; GET /tasks/:id/comments
- POST/DELETE /tasks/:id/dependencies
- GET /projects/:slug/activity ; GET /activity (org-wide, viewer+)
- GET/POST/DELETE /tokens (own only; POST returns full token once)
- POST /heartbeats — body {repo, branch}; auth token only; 202
- GET /capacity — per-user: active_sessions, in_progress_tasks[], last_seen, unlisted[]
- GET /events — SSE stream; query ?project= optional; emits activity rows
- POST /webhooks/github — HMAC (X-Hub-Signature-256) against org webhook secret
- POST /webhooks/transcript — body {project_slug, transcript, source}; 202, creates meeting_review
- GET/POST /projects/:slug/meeting-reviews ; POST /meeting-reviews/:id/apply
  - apply body: {accepted_proposal_ids[]} — only accepted items mutate tasks

OpenAPI generated from zod route schemas; served at /api/openapi.json.

---

## 4. MCP server (/mcp, streamable HTTP)

Auth: Bearer token. Every tool = thin wrapper over the same service layer + assertCan.
All responses include display keys ("LAI-42") not raw ids where user-facing.

| tool | input | returns |
|---|---|---|
| list_projects | {} | projects the user can read |
| list_ready_tasks | {project?} | tasks status in ('todo','backlog') with all dependencies done, assigned to me or unassigned, sorted p1→p3 |
| get_task_context | {task} | task + description + comments + dependencies + linked activity |
| get_project_context | {project} | context_md + last 10 decisions + open task summary |
| create_task | {project, title, description?, priority?, discovered_from?} | created task; created_via='mcp' |
| start_working | {task} | sets assignee=me, status='in_progress'; 409 if someone else's in_progress |
| update_status | {task, status} | validated transition |
| add_comment | {task, body} | comment |
| finish_task | {task, summary} | status='review' (NOT done — humans/PM close), summary posted as comment |
| log_unlisted_work | {repo, note} | records idea/work outside any project for triage |

Guardrail: tools never bulk-mutate; one task per call. `finish_task` deliberately
stops at 'review' — agents don't self-certify done.

---

## 5. Plugin & hooks payloads

Hook heartbeat (SessionStart, Stop, and every 5 min while active via PostToolUse
throttle): `curl -s -X POST $LAIKA_URL/api/v1/heartbeats -H "Authorization: Bearer
$LAIKA_TOKEN" -d '{"repo":"<git remote basename>","branch":"<git branch>"}'`
Fail silent (|| true) — a down board must never break a coding session.

Plugin env: LAIKA_URL, LAIKA_TOKEN (written by /laika:setup into user settings).
Commands: /laika:setup, /laika:status (calls capacity for self), /laika:tasks
(list_ready_tasks), /laika:standup (my activity last 24h formatted).
Skill: teaches claim-before-code, finish→review, discovered_from, log_unlisted_work.

---

## 6. Meeting diff contract

LLM call (org provider) receives: transcript + open tasks (key, title, status,
assignee) + last context_md. Must return strict JSON:
`{ proposals: [{kind:'new'|'change'|'dead'|'decision', task?, title?, description?,
changes?, reason, quote}] }`
Each proposal renders in the review screen with its transcript quote; nothing
applies without explicit human acceptance. Accepted 'decision' items append to
context_md with date.

---

## 7. Env & ops

| var | default | notes |
|---|---|---|
| PORT | 3000 | |
| DATA_DIR | /data | db at $DATA_DIR/laika.db, backups/, secret |
| SERVER_SECRET | auto-generated to $DATA_DIR/secret on first boot | |
| PUBLIC_URL | required for invites/webhooks | |
| DISABLE_INVITE_ONLY | unset | |

Cron (in-process): nightly snapshot (keep 14), heartbeat retention, stale-task
flagging (in_progress + no heartbeat/commit 3 days), invite expiry.
No telemetry. No external calls except org-configured AI endpoint + configured SMTP.

## 8. Non-goals v1 (do not build)
Multi-org, Postgres, websockets, custom fields, file uploads, plugin system,
mobile app, SSO, zero-downtime deploys.
