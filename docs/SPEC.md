# Laika — v1 Specification

Status: **authoritative for M1–M7** · Owner: CHIEF session · Last updated: 2026-08-24

This document is the source of truth. Builders implement exactly this; a
deviation requires a CHIEF-approved task that updates this file **first**. If the
code and this document disagree, that is a bug in one of them — raise it in your
log and CHIEF resolves it in `DECISIONS.md`. Do not silently diverge.

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
  single feed behind audit, presence, the dashboard, and SSE.
- **Agents do not self-certify.** `finish_task` stops at `review`. A human or CHIEF
  closes work.
- **Your data stays yours.** Self-hosted, one SQLite file on a volume you own,
  **no telemetry of any kind** (§13.4).

### 1.1 Non-goals for v1 — do not build

Multi-org / multi-tenant hosting, Postgres, WebSockets, custom fields, file
uploads, a plugin system of our own, mobile apps, SSO/SAML/SCIM, zero-downtime
deploys, **story points**, time tracking, **per-task planned or due dates**, and
email as a *primary* interface (transactional invite mail only).

**Changed 2026-08-24 (D-013, D-014).** "Sprints" and "Gantt charts" were on this
list and are not any more: sprints ship in Phase 2 (§4.15) and a **sprint-based**
timeline in Phase 2.5 (§11.4.3). Note what did **not** move — *story points* and
*per-task planned/due dates* remain non-goals. The timeline draws its axis from
sprint boundaries, never from dates on individual tasks. That distinction is the
whole reason the feature is cheap; see D-014 before adding a date column.

---

## 2. Glossary

| Term | Meaning |
| --- | --- |
| **Org** | The single organisation this deployment serves. Owns projects, users, settings. |
| **Project** | A board. Has a slug (`laika`), a display prefix (`LAI`), members, a context doc, and tasks numbered `LAI-1`, `LAI-2`, … |
| **Task** | The unit of work. What agents claim and humans triage. |
| **Actor** | Whoever a request is attributed to — always a user, whether they arrived via session cookie or token. |
| **Actor kind** | `user` (cookie) or `agent` (token). Same person, different hands. |
| **Token** | A personal access token: hashed, scoped, revocable, belongs to exactly one user. |
| **Heartbeat** | A metadata-only ping: this user is in this repo on this branch, now. |
| **Ready** | A task nobody is doing whose dependencies are all `done` — the thing an agent should pick up next. Derived, never stored. |
| **Context doc** | `projects.context_md` — the shared project brief served to agents by `get_project_context`. |

---

## 3. Roles and permissions

Two levels, deliberately. **Org role** gates global actions; **project role**
gates work inside a project.

- **Org roles** — `owner`, `admin`, `member`, `viewer`.
- **Project roles** — `lead`, `member`, `viewer`, held in `project_memberships`.

Org `owner` and `admin` hold **implicit `lead`** on every project and bypass the
membership check. A user whose org role is `viewer` may hold **only** the project
role `viewer` — no escalation via project assignment, enforced in code.

- **Owner** — the person who installed Laika. Exactly one, transferable.
- **Admin** — creates projects, invites, sets roles, manages webhooks and org
  settings. Cannot delete the org or transfer ownership.
- **Member** — the working role. Creates and edits tasks, comments, claims work,
  mints their own tokens. **This is what agent sessions run as.**
- **Viewer** — read-only. Tokens are forced to `read_only` scope.

### 3.1 Org-level permission matrix

| Action | Owner | Admin | Member | Viewer |
| --- | :---: | :---: | :---: | :---: |
| Delete org data / transfer ownership | ✓ | — | — | — |
| Org settings (AI provider, SMTP, signup mode) | ✓ | ✓ | — | — |
| Create / archive project | ✓ | ✓ | — | — |
| Invite users / change org roles | ✓ | ✓ (not to Owner) | — | — |
| Deactivate user | ✓ | ✓ | — | — |
| View member list | ✓ | ✓ | ✓ | ✓ |
| Join a `public` project | ✓ | ✓ | ✓ (as member) | ✓ (as viewer) |
| Generate, read and revoke own tokens | ✓ | ✓ | ✓ | ✓ (`read_only` forced) |
| List / revoke **anyone's** token | ✓ | ✓ | — | — |
| Log own unlisted work | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
| Send own heartbeat | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
| Export audit log | ✓ | ✓ | — | — |

**Logging unlisted work is deliberately asymmetric with reading it** (added
2026-08-31, LAI-408). `log_unlisted_work` (§7.1) is the one MCP tool with no REST
twin (D-024): an agent noticing something outside any project has nowhere else to
put it. Anyone may add to that pile — it is **their own record about their own
work**, creating nothing in any project and visible to nobody who could not
already read the audit log. Triaging it is the restricted half, and follows
*Export audit log* like every other `project_id IS NULL` row.

The Viewer cell is `✓` for the same reason the token row's is, and with the same
consequence: a Viewer's token is forced `read_only`, and logging is not a read
action, **so a Viewer is refused in practice.** The `✓` records that the
restriction comes from the credential rather than from the role — which matters,
because if `read_only` forcing were ever relaxed, this cell would already say
what should happen rather than needing to be re-decided. It is not an oversight
and a `—` here would be a different claim.

There is no cell for *writing* to the pile from the REST API because there is no
such endpoint; §6.4 exposes only `GET /unlisted`, promote and dismiss.

**Sending a heartbeat follows the same shape, and for the same reason** (added
2026-09-01, LAI-417). `POST /api/v1/heartbeats` (§9.1) is token-authenticated
only and records `repo`, `branch` and a timestamp — **your own record about your
own work**, creating nothing in any project. Anyone may send one; reading the
pile back as presence or capacity is the restricted half and follows *Export
audit log* like every other `project_id IS NULL` view.

The Viewer cell is `✓` for the reason the two rows above it are: the restriction
comes from the **credential**, not the role. §9.1 is token-only, a Viewer's token
is forced `read_only`, and sending is not a read action — so a Viewer is refused
in practice while the matrix records what should happen if forcing were ever
relaxed.

**A heartbeat writes no `activity` row.** §4.8's `heartbeat.session` is a
**session** verb, not a per-ping one — one row every five minutes per agent would
drown the feed that §4.8 says serves audit, presence, the dashboard and the SSE
stream. What writes `heartbeat.session`, and when, belongs with the session
lifecycle in M4's plugin work or M5's presence view; `POST /heartbeats` is not
it.

**Reading the org-wide activity feed follows *Export audit log*.** Rows with
`project_id IS NULL` — `token.created`, `member.role_changed`, `unlisted.logged`,
`org.created` — **are** the audit log, read live rather than exported, so they
answer to the same cell. Project-scoped rows follow `project.read` instead, which
is the rule that governs reading the same events over REST: a stream that showed
more than the REST API would be a second, weaker permission system (§11.5).

**Deliberately not a separate cell.** Adding one would mean a new action whose
only definition is "the same people as Export audit log", and two cells that must
be kept in step by hand. If the two ever need to differ — a Member who may watch
the feed but not export it — that is the moment to split them, and the split will
be obvious because someone will be asking for it.
| Configure webhooks | ✓ | ✓ | — | — |
| View the organisation | ✓ | ✓ | ✓ | ✓ |

**"View the organisation" is `org.read` and is a read action** (D-048) — a
`read_only` token may do it. It does **not** cover the AI provider block:
`configured`, `provider` and `key_last4` are gated on `org.settings.edit`
(admin+), field-level, the same way `ai_api_key` is already write-only, and the
block is **absent rather than null** for a caller who may not see it — `null`
would say *"no provider is configured"*, which is a different fact.

The row was added rather than borrowed from *"View member list"*, which grants
the same four roles today. Whether an org has an LLM provider wired up is not
implied by who is in it, so the borrow would have been **a fact about the current
payload rather than a property of the row** — and the next field added to the
response would inherit a grant nobody reviewed.

### 3.2 Project-level permission matrix

Requires membership, unless the actor is org Owner/Admin (implicit `lead`).

| Action | Lead | Member | Viewer |
| --- | :---: | :---: | :---: |
| Manage project members | ✓ | — | — |
| Edit project settings and `context_md` | ✓ | — | — |
| Create / edit / delete sprints | ✓ | — | — |
| Apply or remove a task's tags | ✓ | ✓ | — |
| Rename or delete a tag project-wide | ✓ | — | — |
| Assign tasks into or out of a sprint | ✓ | ✓ | — |
| Create / edit / move any task | ✓ | ✓ | — |
| Claim a task (`start_working`) | ✓ | ✓ | — |
| Assign a task to someone else | ✓ | ✓ | — |
| Add comment | ✓ | ✓ | — |
| Edit / delete comment | own + any | own | — |
| Cancel / delete task | ✓ | own-created | — |
| Add / remove dependencies | ✓ | ✓ | — |
| Read tasks, comments, activity, capacity | ✓ | ✓ | ✓ |
| Watch / unwatch a task | ✓ | ✓ | ✓ |
| Apply a meeting-diff proposal | ✓ | ✓ | — |

### 3.3 The `can()` module is the only authority

One implementation, `server/src/policy/can.ts`:

```ts
can(actor: Actor, action: Action, resource: Resource): boolean
assertCan(actor, action, resource): void   // throws the §6.3 `forbidden` error
```

Rules that are not negotiable:

1. **Every** route and **every** MCP tool calls `assertCan` before reading or
   writing — REST, MCP, webhook-triggered, cron-triggered, admin. No exceptions,
   no "internal" path.
2. `can()` is pure and synchronous. Everything it needs (actor, org role,
   resolved project role, resource ownership) is loaded by the caller and passed
   in.
3. **Deny by default.** Unknown action, missing membership, deactivated user, or
   an unmatched case returns `false`.
4. Token scope is applied **after** the role decision and can only ever *narrow*
   it (§6.2). A token never grants more than its user has.
5. It is unit-tested against §3.1 and §3.2 cell by cell. That test file is the
   executable version of these tables.

---

## 4. Data model

SQLite via Drizzle. Ids are ULIDs stored as `text` (sortable, no coordination).
Timestamps are `integer` unix-milliseconds UTC, named `created_at` / `updated_at`.
Soft-delete only where noted. All foreign keys are indexed.

### 4.1 `users`

| field | type | notes |
| --- | --- | --- |
| `id` | text pk | ULID |
| `email` | text unique | lowercased on write |
| `name` | text | |
| `org_role` | text | `owner` \| `admin` \| `member` \| `viewer` |
| `avatar_color` | text | derived from id — **no uploads in v1** |
| `is_active` | integer | 0 = deactivated, row kept for history |
| `created_at`, `updated_at` | integer | |

Credentials, sessions and verification records belong to **better-auth's own
tables** (§11.3). Do not hand-write password or session columns.

### 4.2 `orgs` — exactly one row

| field | notes |
| --- | --- |
| `id`, `name` | |
| `owner_user_id` | |
| `invite_only` | integer, default **1** (D-004) |
| `presence_enabled` | integer, default **1** — org-wide off switch for heartbeats. When 0, `POST /heartbeats` returns `202` and discards, and Presence/Capacity show a disabled state rather than an empty one. D-005 makes the product's privacy claim; this makes it enforceable by the org, not just promised by us. |
| `ai_provider` | `anthropic` \| `openai_compatible` \| `null` |
| `ai_base_url` | for Ollama / vLLM |
| `ai_api_key_enc` | AES-256-GCM, key derived from `LAIKA_SECRET` (§12) |
| `smtp_json_enc` | nullable, same encryption |
| `github_webhook_secret_enc` | nullable, same encryption |

**Single-org deployment**: one row, created by the first-run wizard. Other tables
still carry `org_id` where it matters, so the constraint is data-level and a
future multi-org becomes a migration rather than a rewrite.

### 4.3 `projects`

| field | notes |
| --- | --- |
| `id`, `org_id`, `name` | |
| `slug` | unique, lowercase |
| `prefix` | short uppercase display key (`LAI`), unique per org |
| `description` | |
| `repo` | nullable — `owner/name` of the git repository this project tracks. Maps an incoming heartbeat's `repo` (§9.1) to a project; without it presence cannot be attributed. A full remote URL stored here still matches: §9.1 normalises both sides. |
| `visibility` | `public` (org members may self-join) \| `private` |
| `context_md` | text — the shared project brief served to agents (§7.1) |
| `archived_at` | nullable |

### 4.4 `project_memberships`

`id`, `project_id`, `user_id`, `role` (`lead` \| `member` \| `viewer`),
`created_at`. Unique on (`project_id`, `user_id`). This is what `can()` reads.

**Constraint (enforced in code):** a user with `org_role = 'viewer'` may hold only
project role `viewer`.

### 4.5 `tasks`

| field | notes |
| --- | --- |
| `id` | ULID |
| `project_id` | |
| `number` | integer, per-project sequence → display key `LAI-42` |
| `title`, `description_md` | |
| `status` | `backlog` \| `todo` \| `in_progress` \| `review` \| `done` \| `cancelled` |
| `priority` | `p1` \| `p2` \| `p3`, default `p2` |
| `assignee_id` | nullable FK `users` |
| `sprint_id` | nullable FK `sprints` (§4.15) — unassigned means backlog, not "no sprint yet" |
| `acceptance_md` | nullable — what *done* means for this task, in prose (LAI-092) |

**`blocked_by` is what a task waits on, and `blocks` is the reverse.** Both are
on `TaskView`; they are never merged, because a task blocking three others and
one blocked by three are the same shape with opposite meanings. **Readiness
depends only on `blocked_by`** — never on what a task blocks.

The field was called `dependencies` until 2026-09-01 (LAI-099, **D-044**), which
said nothing about direction once `blocks` existed beside it. **Three surfaces
deliberately keep the old word**, each for a reason recorded where the name is:

- **`POST /tasks/:id/dependencies`** — a path segment names a **collection**, not
  a direction, and has no sibling to be confused with. Its body is
  `{ blocked_by_task_id }`.
- **`activity` payload keys** — `activity` is append-only, so renaming new rows
  would split the audit trail into two vocabularies by date: the defect LAI-045
  existed to remove, reshaped.
- **`task_dependencies.depends_on_task_id`** — internal; nothing outside the
  server reads it.

**A table inside §4 is a schema declaration, not a formatting choice.**
`schema-spec-drift.test.ts` reads every §4 table as `field | notes` and compares
it against `schema.ts`, so prose set in a table becomes a column the code is
missing. This paragraph was a table for ten minutes and the check caught it —
which is the check working on the document it exists to pin.
| `created_by` | FK `users` |
| `created_via` | `web` \| `mcp` \| `api` \| `webhook` \| `meeting` |
| `discovered_from` | nullable self-FK |
| `branch` | nullable, last branch seen working on it |
| `external_ref` | nullable, e.g. a GitHub PR |
| `stale_flagged_at` | nullable, set by cron (§11.6) |
| `started_at`, `completed_at` | nullable — **served on `TaskView`** (LAI-126). `started_at` is stamped the **first** time a task enters `in_progress`, by any route in, and a later re-entry does not move it: a task sent back for rework did not start twice, and overwriting would silently shorten every cycle time derived from it (§11.6). |

**`started_at` and `completed_at` are actuals, not a plan.** D-014 gives tasks no
dates so the timeline stays a rendering pass over sprint boundaries rather than a
scheduling engine. These record what *happened*; a Gantt bar asserts what is
*planned*. Serialising them does not reverse D-014, and **drawing task bars from
them is a separate decision** that needs the owner rather than a UI change.

**`ready` is derived, not stored.** A task is ready when
`status IN ('backlog','todo') AND assignee_id IS NULL AND every dependency is
'done'`. This is what `list_ready_tasks` returns (§7.1) and what the board's
"Ready" column shows. Deriving it means it can never go stale.

**`backlog` vs `todo`:** `backlog` is unrefined; `todo` is groomed and ready to
be picked up. Both count as ready when unassigned and unblocked — the distinction
is for humans triaging, not for the readiness computation.

### 4.6 `task_dependencies`

`task_id`, `depends_on_task_id`, `created_at`. Unique pair. Self-reference and
cycles are rejected at write time.

`discovered_from` is a **different** relationship — provenance, not blocking — and
is a column on `tasks`, so a discovered task can be worked before its parent
finishes.

### 4.7 `comments`

`id`, `task_id`, `author_id`, `body_md`, `created_via` (same enum as tasks),
`edited_at`, `deleted_at` (soft), `created_at`, `updated_at`.

### 4.8 `activity` — append-only

| field | notes |
| --- | --- |
| `id` | ULID |
| `org_id` | **not null** — every event belongs to the one org |
| `project_id` | **nullable** — org-scoped events have no project (D-022) |
| `task_id` | nullable |
| `actor_id` | **nullable, and only when `actor_kind = 'system'`** (D-022) |
| `actor_kind` | `user` (cookie) \| `agent` (token) \| `system` (no human — cron or webhook) |
| `actor_token_id` | nullable — *which* token, for audit |
| `type` | closed vocabulary, below |
| `payload_json` | the before/after diff or details |
| `created_at` | |

**Nullability follows from the type vocabulary, not from convenience** (D-022).
Applied literally, an all-not-null table would make events this same section
requires impossible to write:

- **No project**: `member.added` at org level, `member.role_changed`,
  `token.created`, `token.revoked`, `unlisted.logged`.
- **No human actor**: `webhook.commit`, `webhook.received`, and everything the
  in-process cron writes (§11.6) — heartbeat pruning, stale-task flagging, invite
  and meeting-review expiry.

`actor_id IS NULL` is **not** a general allowance. A database check constraint
ties it to `actor_kind = 'system'` in both directions, so a null actor always
means "no person did this" and never "somebody forgot to set it". That
distinction is the whole value of an audit table.

**No updates, no deletes, ever** — no endpoint exists, the Drizzle helper module
exposes no mutation path, and a test asserts attempts fail. This one table feeds
**audit**, **presence**, the **dashboard**, and the **SSE stream** (§11.5).

Types: `org.created`, `task.created`, `task.updated`, `task.status_changed`,
`task.assigned`, `task.dependency_added`, `task.dependency_removed`,
`comment.added`, `comment.edited`, `comment.deleted`, `project.created`,
`project.updated`, `project.archived`, `member.added`, `member.role_changed`,
`member.removed`, `token.created`, `token.revoked`, `heartbeat.session`,
`webhook.commit`, `webhook.received`, `meeting.applied`, `unlisted.logged`,
`unlisted.promoted`, `unlisted.dismissed`, `project.context_updated`,
`sprint.created`, `sprint.updated`, `sprint.deleted`, `sprint.tasks_changed`,
`user.deactivated`, `user.reactivated`, `task.stale_flagged`,
`heartbeat.pruned`, `invite.expired`, `meeting_review.expired`.

**The nine verbs added 2026-09-01 are the same argument, four more times.**
Sprints, the project context document, unlisted-work triage and deactivation
were all filing under a verb that does not name them — sprints and context under
`project.updated`, promote and dismiss under `unlisted.logged`, and deactivation
under nothing at all. Each was a recorded compromise; four of them is the
vocabulary being wrong (LAI-113, LAI-222).

**The test is the one `project.archived` already passed:** could a reader answer
*"when did this happen?"* without inspecting a payload? *"When was this sprint
deleted?"*, *"when did the brief last change?"*, *"who dismissed that note?"* and
*"who was locked out?"* all failed it.

**`sprint.tasks_changed` is one verb for both directions** — assigning into and
removing from a sprint both answer *"what moved in or out"*, and the payload
carries which. **`user.deactivated` and `user.reactivated` are two**, because
*"who was locked out"* and *"who was let back in"* are different questions a
person asks (D-048). One verb with a direction in the payload is the thing this
vocabulary exists to avoid.

**Migrating existing rows is not required and must not be attempted.** `activity`
is append-only in both directions, so rows written before a verb existed keep the
one they were written with, and a reader of old history needs `payload.action`.
That is the honest cost of having had the vocabulary wrong, and **every reader of
that history must therefore accept two vocabularies permanently** —
`latestFieldEdit` is the first and was found by a test rather than by design.

**The four cron verbs close a contradiction this section had with itself**
(LAI-431). D-022's note below already names the in-process cron as a writer of
rows with no human actor — *"heartbeat pruning, stale-task flagging, invite and
meeting-review expiry"* — and the type list had a verb for **none** of them. The
nullability rule was justified by rows the vocabulary made impossible to write.

**`heartbeat.pruned` is one row per run, not per heartbeat.** Thirty days of an
active org is thousands of deletions, and a row each would make the audit trail
mostly a record of presence data being removed — which is a strange thing for a
table whose privacy claim is D-005. One row carrying the count and the cutoff
answers *"was retention running"*, which is the only question anyone asks of it.

**`task.stale_flagged` rather than `task.updated`**, for LAI-113's reason: a
reader filtering on `type` should not open a payload to learn that this update
was the cron and not a person. It is also the one cron row a human sees, on the
task's own timeline.

**Four verbs, not six.** The note enumerates the writers, and the nightly
snapshot and the weekly vacuum are **not** among them. A backup is not a change
to the product's history and a `VACUUM` changes no row; writing them would put
two entries a week in every feed saying nothing happened. Their jobs say so at
the site, so a reader finding no `appendActivity` does not assume it was
forgotten.

**`project.archived` is its own verb, not a flag on `project.updated`.** Archiving
removes a project from everyone's board; a settings edit does not. Reading an
audit trail to answer "when did this project disappear?" should not require
inspecting the payload of a generic update.

**`enums.ts` and the `activity` CHECK constraint are the enforcement**; this list
is the description. If they disagree, the constraint wins and this list is the
bug — adding a verb is a schema change and therefore a task.

`org.created` is written once, by first-run setup (§6.4 `POST /setup`), with the
Owner as actor. An audit trail that begins at the first *project* has a hole
where the instance itself was created.

### 4.9 `tokens`

| field | notes |
| --- | --- |
| `id`, `user_id`, `name` | |
| `prefix` | first 8 chars, shown in the UI so a token is identifiable |
| `token_hash` | SHA-256 of the full secret |
| `scope` | `full` \| `read_only` (forced `read_only` for org viewers) |
| `project_ids_json` | null = all the user's projects |
| `last_used_at`, `expires_at`, `revoked_at` | nullable |

Token format `lai_<40 base62>`. **The secret is never stored and is shown exactly
once, at creation.**

**`name` is wire-visible, and that constrains what renaming means** (added
2026-09-01, LAI-093). `TaskView.created_by_client` reports the name of the token
that created a task, **derived by joining `activity.actor_token_id` to this
column** rather than copied onto `tasks`. So:

- **Renaming a token renames it everywhere, retroactively.** A person reading a
  task created six months ago sees the token's *current* name. That is deliberate
  — a stored copy would still say the old one and nothing would reconcile them —
  but it means a name is not a historical record of what the client was called at
  the time.
- **A name is visible to anyone who can read the task.** It is not private
  metadata. Do not put anything in it you would not show a project member.
- **Deleting a token removes the name, not the attribution.** `actor_token_id` is
  `ON DELETE set null`, so the audit row outlives the token and
  `created_by_client` becomes `null` — never `"unknown"`, which would be a claim
  where the truth is an absence. `null` also covers a browser session and a task
  older than tokens; all three mean the same thing to a reader.

### 4.10 `heartbeats`

`id`, `user_id`, `token_id`, `repo`, `branch`, `matched_task_id` (nullable,
resolved server-side from the branch — §9.2), `created_at`.

**Metadata only**: repo name, branch name, timestamp. Never file paths, diffs,
prompts, or transcript content (D-005). Cron deletes rows older than 30 days.

### 4.11 `invites`

`id`, `org_id`, `email` (nullable for link invites), `org_role`, `project_id`
(nullable), `project_role` (nullable), `token_hash`, `created_by`, `expires_at`,
`accepted_by`, `accepted_at`, `created_at`.

### 4.12 `meeting_reviews`

`id`, `project_id`, `source`, `transcript_hash`, `proposals_json` (§10.2),
`status` (`pending` \| `applied` \| `expired`), `reviewed_by`, `reviewed_at`,
`created_at`, `expires_at`. Proposals expire unreviewed after 7 days.

### 4.13 Indexes that must exist

`tasks(project_id, status)`, `tasks(assignee_id, status)`,
`tasks(project_id, updated_at)`, `tasks(project_id, number)` unique,
`task_dependencies(depends_on_task_id)`, `comments(task_id, created_at)`,
`activity(project_id, created_at)`, `activity(task_id, created_at)`,
`heartbeats(user_id, created_at)`, `tokens(token_hash)` unique,
`project_memberships(project_id, user_id)` unique, `projects(slug)` unique,
`unlisted_work(user_id, created_at)`, `meeting_reviews(project_id, status)`,
`sprints(project_id, starts_on)`, `sprints(project_id, status)`, `tasks(sprint_id)`.
`tags(project_id, name)` unique and `task_tags(tag_id)` — the `?tag=` filter
reads from the tag side, so the join needs an index from that end too.

### 4.14 `unlisted_work`

Appended after §4.13 rather than inserted before it, so the Indexes section keeps
its number (D-011 — LAI-003 cites `§4.13`).

`id`, `user_id`, `token_id`, `repo`, `note`, `promoted_task_id` (nullable),
`dismissed_at` (nullable), `created_at`.

Written **only** by the `log_unlisted_work` MCP tool (§7.1): an agent noticing
work that belongs to no project records it here instead of inventing a task.
Read by the capacity view (§9.3) and promoted to a real task by
`POST /api/v1/unlisted/:id/promote`, which is an ordinary `can()`-checked task
creation with `created_via: 'mcp'` provenance preserved on the resulting task.

Same privacy rule as heartbeats (D-005): `note` is agent-authored prose, `repo`
is a name. No file contents, no diffs, no prompt text.

### 4.15 `sprints`

Appended after §4.14 so §4.13 Indexes keeps its number (D-011).

| field | notes |
| --- | --- |
| `id` | ULID |
| `project_id` | FK `projects` |
| `name` | e.g. "Sprint 4" — unique per project |
| `goal` | nullable, one line: what this sprint is for |
| `starts_on`, `ends_on` | integer unix-ms, date-only semantics in the project's timezone |
| `status` | `planned` \| `active` \| `completed` |
| `created_at`, `updated_at` | |

**Rules.**

- `ends_on` must be after `starts_on`; both are required.
- **At most one `active` sprint per project**, enforced at write time.
  Transitioning a second sprint to `active` is `409 conflict`.
- Sprints of the same project **may not overlap** in date range. This is what
  makes §11.4.3's timeline a clean single-track axis rather than a layout problem.
- A task's `sprint_id` is nullable. Null means *not in a sprint* — the ordinary
  state for backlog work, and never an error.
- Deleting a sprint sets `sprint_id = NULL` on its tasks; it never deletes tasks.
- Completing a sprint does **not** change its tasks' statuses. Unfinished work
  stays unfinished and is moved deliberately, not swept.

**Story points are still a non-goal** (§1.1). A sprint carries dates and a goal,
not a velocity model.

---

### 4.16 `tags`

Appended after §4.15 so §4.13 Indexes keeps its number (D-011). Decided in D-027.

**`tags`**

| field | notes |
| --- | --- |
| `id` | ULID |
| `project_id` | FK `projects` — tags are **project-scoped** |
| `name` | lowercase slug, unique per project |
| `created_at` | |

### 4.17 `task_tags`

The join between §4.5 and §4.16.

| field | notes |
| --- | --- |
| `task_id` | FK `tasks` `ON DELETE cascade`, half of the primary key |
| `tag_id` | FK `tags` `ON DELETE cascade`, the other half |

**Rules.**

- **A task has many tags and a tag has many tasks.** The design applies two to a
  single task (`agent` + `core`), so this is a join table, not a column.
- `name` matches `^[a-z0-9][a-z0-9-]{0,23}$`, **enforced at the database with
  `GLOB`, not `LIKE`** — for two independent reasons. `LIKE` has no character
  classes at all, so `LIKE '[a-z0-9]%'` matches the bracket *literally* and
  rejects every real name; and `LIKE` is case-insensitive for ASCII, so a pattern
  that does work (`LIKE 'u%'`) accepts `UI`. Case-variant duplicates are the
  failure that makes a tag filter worthless.
- **Unique per project**, not per org. `ui` on a server project and `ui` on the
  web project are different concerns.
- A tag is created as a side effect of applying it — no separate create step.
- **Deleting a tag never deletes a task.** Join rows only, as §4.15 does.
- **Tags carry no colour.** The design renders every chip in the neutral
  `--tub`/`--bd` pair.
- Changing a task's tags is `task.updated` with `{ field: 'tags', from, to }`.

**Non-goal: hierarchy.** Tags are flat. `priority`, `sprint_id` and
`discovered_from` already carry the structured groupings.

### 4.18 `task_watchers`

Who wants to hear about a task (§6.4, LAI-094).

| field | notes |
| --- | --- |
| `id` | |
| `task_id` | FK `tasks` `ON DELETE cascade` |
| `user_id` | FK `users` `ON DELETE cascade` |
| `watching` | integer boolean — **not** row-presence; see below |
| `created_at`, `updated_at` | |

Unique on (`task_id`, `user_id`).

**Rules.**

- **`watching` is a column, not the existence of a row, and that is the whole
  design.** Assigning a task, commenting on it, or being mentioned in it makes a
  person a watcher **unless they have explicitly unwatched it**. Three states
  have to be distinguishable: *no row* (the implicit rules apply), `watching = 1`
  (explicitly in), `watching = 0` (explicitly out). Row-presence can express two
  of the three, and the one it loses is the one that matters — **a person who
  unwatches would be re-subscribed by their own next comment**, which is the
  behaviour most likely to make someone turn notifications off entirely.
- A watcher who loses read access to the project stops receiving anything: the
  stream answers to `project.read` (§11.5), and this table never widens it.

### 4.19 `comment_mentions`

Who was named in a comment (§4.7, LAI-094).

| field | notes |
| --- | --- |
| `id` | |
| `comment_id` | FK `comments` `ON DELETE cascade` |
| `user_id` | FK `users` `ON DELETE cascade` |
| `created_at` | |

Unique on (`comment_id`, `user_id`).

**Rules.**

- **`@name` matches the local part of a user's email**, case-insensitively —
  `@ada` for `ada@kvelld.co.za`. There is no handle column, and adding one is a
  §4.1 change with a uniqueness rule, a backfill and a collision story; it is not
  this feature's to make. Email is already unique per instance (§4.2 — one org)
  and is stable in a way `name` is not.
- **An ambiguous `@name` resolves to nobody.** Two accounts can share a local
  part across domains, and picking one silently is worse than not linking: the
  writer believes they notified somebody and the wrong person may be notified
  instead. It renders as plain text.
- **A mention never widens who can see anything.** A row is written only if the
  mentioned person passes `project.read` on that task's project — otherwise the
  text stands and no row exists. A mention is not an invitation.
- **Rows are the record of what was written**, so editing a comment
  re-derives them and deleting it cascades. A name that no longer appears in the
  body is not a mention.

## 5. Task lifecycle

```
        create              claim / start_working          finish_task
backlog ──▶ todo ──────────────────────────▶ in_progress ──────────────▶ review
           (ready when unassigned                                          │
            and deps all done)                                            │ human/CHIEF approves
                                                                          ▼
                                                                        done
```

- **Claiming is a compare-and-swap.** `start_working` sets `assignee_id` and
  `status = 'in_progress'` **only if the task is still unassigned**. A second
  claimant gets `409 conflict` with the current assignee in the body. This is the
  API-level twin of the file-move lock the build sessions use by hand.
- Moving to `review` requires the assignee, a project `lead`, or org Admin/Owner.
- **`done` is never set by `finish_task`.** Agents do not self-certify.
- A task may be reassigned while `in_progress` — that is `task.assigned`, not a
  status change.
- Every transition writes exactly one `activity` row and emits one SSE event.

---

## 6. REST API

Base path **`/api/v1`**. JSON in, JSON out, UTF-8. Any non-`GET` requires
`Content-Type: application/json`.

### 6.1 Authentication

Two credentials, one resolved `Actor`:

1. **Session cookie** — better-auth, for the SPA. CSRF-protected,
   `SameSite=Lax`, `Secure` when not on localhost. → `actor_kind: user`.
2. **Personal access token** — `Authorization: Bearer lai_<secret>`. Looked up
   by SHA-256 hash, constant-time compared, rejected if revoked or expired.
   `last_used_at` updated at most once a minute. → `actor_kind: agent`.

There is no third path. Webhooks authenticate by signature and act as a system
actor with a fixed, minimal capability set (§10).

#### Origin, and what a mismatch returns

**`/api/v1/auth/*` is origin-checked; nothing else is.** The REST endpoints and
the SSE stream (§11.5) rely on the `SameSite=Lax` cookie instead. A reverse proxy
that rewrites `Origin` therefore breaks sign-in and **nothing else** — worth
knowing, because a board that signs in and then silently stopped receiving events
would be far harder to diagnose.

Trusted origins are **`LAIKA_PUBLIC_URL` plus its loopback spellings** —
`localhost`, `127.0.0.1` and `::1` name the same machine, and a page served from
one of them **is served by this instance**: nobody else can bind that port on
that host. Treating them as different origins stops no attacker. It does lock an
operator out of their own instance, which is exactly what happened (LAI-090).

It deliberately does **not** widen to LAN addresses or hostnames, and adds
nothing at all when `LAIKA_PUBLIC_URL` is a real domain.

**A mismatch returns `403 forbidden` and names the configured URL.** It must
never present as a credential failure — the three outcomes below are distinct and
a client must be able to tell them apart:

| Situation | Status |
| --- | --- |
| right credentials, untrusted origin | `403` — *"This instance is configured for …"* |
| wrong credentials, trusted origin | `401` — *"Invalid email or password"* |
| right credentials, trusted origin | `200` |

**`LAIKA_PUBLIC_URL` must be the URL people actually type.** It is already
required (D-018); this is the constraint on its *value*. If it does not match,
sign-in fails with a message about the origin — not about the password.

**Repeated failed sign-ins for one account are throttled** (LAI-219). Five
consecutive failures are free; the next attempt is refused with `429` and a
`retry_after_seconds`, starting at 30 seconds and doubling to a cap of 15
minutes. A success, or an hour of quiet, clears the count.

**A delay rather than a lockout, deliberately.** A lockout would let anyone close
an account they cannot enter, and an invite-only instance (D-004) has a small,
known list of addresses. The cap bounds the owner's worst case and clears itself
without an administrator.

The counter is keyed on the **submitted address**, whether or not an account has
it, so the response never reveals which addresses exist — the same reason the
table above gives `401` to both a wrong password and an unknown address.

**Only a rejected credential counts.** An origin refusal is a `403` raised
*before any password is looked at*, so counting it would let an attacker throttle
any account from a foreign origin **without ever submitting a guess** — a cheaper
denial of service than the one this trade accepts, arrived at by defending
against the expensive one. A malformed body is not an attempt either.

### 6.2 Authorisation

Handler resolves `Actor` → loads the resource → `assertCan(...)` → 403 if false.
Token scope narrows afterwards: `read_only` permits every `GET` the user's role
allows and nothing else; `project_ids_json`, when set, restricts the token to
those projects. A Viewer's token can never write, whatever its scope says.

### 6.3 Conventions

- **Pagination**: `?limit=` (default 50, max 200) and `?cursor=` (opaque,
  encodes `(sort_key, id)`). Response `{ "data": [...], "next_cursor": ... | null }`.
  No offset paging.
- **`updated_since=<unix-ms>`** on every list endpoint: rows changed at or after
  it, **including tombstones** `{ "id": "...", "deleted": true }` for
  soft-deletes. This is how an agent or a reconnecting SPA catches up cheaply.
- **Errors**: `{ "error": { "code", "message", "details" } }`. The vocabulary is
  closed — a handler does not invent a code:

  | code | status |
  | --- | --- |
  | `bad_request` | 400 |
  | `unauthorized` | 401 |
  | `forbidden` | 403 |
  | `not_found` | 404 |
  | `method_not_allowed` | 405 |
  | `conflict` | 409 |
  | `payload_too_large` | 413 |
  | `unprocessable` | 422 |
  | `rate_limited` | 429 |
  | `internal` | 500 |

  **`payload_too_large` and `method_not_allowed` are distinct codes, not folded
  into `bad_request`** (D-021). Clients branch on `code`, not on status, and the
  remedies differ: a too-large body means send less, a wrong method means call
  differently, a malformed body means fix the JSON. Collapsing them would make
  three different problems indistinguishable to the caller. `bodyLimit` is on
  every route (§13.1), so 413 is routine behaviour rather than a corner case.
- **Idempotency**: `POST` accepts `Idempotency-Key`; replays within 24h return
  the original response. Same key with a different body is `conflict`.
- **Rate limits**: in-process token bucket — 120 req/min per token, 600/min per
  session, 30/min for heartbeats. `429` with `Retry-After`, never below one
  second.

  **Writes share the general budget; there is no separate write limit** (D-021).
  Per-token 120/min already bounds the case a write budget was meant to catch —
  an agent looping on `update_status` — more tightly than 60/min writes would,
  because a token cannot exceed 120 requests of *any* kind. A second bucket would
  add machinery for a case the first already covers.

  **Anonymous requests share one bucket, and the liveness probe and static assets
  are exempt from limiting entirely.** A Docker `HEALTHCHECK` that receives a
  `429` marks the container unhealthy and restarts it, turning a burst of
  anonymous traffic into an outage; exempt paths therefore emit no rate headers
  at all, since advertising a budget where none applies misleads the client.

  The single shared anonymous bucket is a **deliberate limitation, not an
  oversight**. The obvious improvement is a per-IP bucket, and behind a reverse
  proxy that requires trusting `X-Forwarded-For` — which, done without knowing
  which hop set it, lets any client forge its own identity and is worse than one
  shared bucket. Laika is explicitly deployed behind Caddy or nginx (§11.7), so
  this is not hypothetical. Changing it is a security decision with its own task
  (LAI-030), not a tidy-up.
- **Validation**: zod at the boundary; unknown body fields are rejected
  (`unprocessable`), not silently dropped. Inferred types are the handler's
  argument types.
- **OpenAPI** generated from the zod route schemas, served at
  `/api/openapi.json`.

### 6.4 Endpoints

```
POST   /api/v1/auth/*                        better-auth mounted routes
GET    /api/v1/setup/status                  POST /api/v1/setup      (disabled once an org exists)
       └ { setup_required, system: { database, migrations_applied, smtp_configured } }
GET    /api/v1/me
GET    /api/v1/org                           PATCH /api/v1/org       (admin+; ai_api_key write-only)
GET    /api/v1/users                         ?limit=&cursor=&updated_since=&include_inactive=
                                             cursor is (name, id) — a directory reads alphabetically
PATCH  /api/v1/users/:id                     (role, deactivate — admin+)
GET    /api/v1/invites                       POST /api/v1/invites    POST /api/v1/invites/accept
GET    /api/v1/invites/:token                unauthenticated preview — org name, inviter, role, expiry
DELETE /api/v1/invites/:id                   revoke a pending invite (admin+)
GET    /api/v1/projects                      POST /api/v1/projects   (admin+)
GET    /api/v1/projects/:slug                PATCH /api/v1/projects/:slug
POST   /api/v1/projects/:slug/join           (public projects)
GET    /api/v1/projects/:slug/members        POST/PATCH/DELETE .../members
GET    /api/v1/projects/:slug/context        PATCH .../context       (lead+)
GET    /api/v1/projects/:slug/tasks          ?status=&assignee=&priority=&ready=&sprint=&tag=&updated_since=&cursor=
GET    /api/v1/projects/:slug/sprints        POST /api/v1/projects/:slug/sprints   (lead+)
GET    /api/v1/sprints/:id                   PATCH /api/v1/sprints/:id   DELETE /api/v1/sprints/:id  (lead+)
POST   /api/v1/sprints/:id/tasks             body { task_ids[] }  — assign into the sprint
DELETE /api/v1/sprints/:id/tasks/:taskId     remove from the sprint (task itself is untouched)
GET    /api/v1/projects/:slug/tags           list with usage counts, for the picker and the filter
PATCH  /api/v1/projects/:slug/tags/:name     rename project-wide (lead+)
DELETE /api/v1/projects/:slug/tags/:name     remove from every task (lead+); tasks are untouched
GET    /api/v1/projects/:slug/timeline       ?from=&to=  — sprints with date ranges and their tasks
POST   /api/v1/projects/:slug/tasks
GET    /api/v1/tasks/:id                     PATCH /api/v1/tasks/:id
POST   /api/v1/tasks/:id/claim               POST /api/v1/tasks/:id/status
PUT    /api/v1/tasks/:id/watch               DELETE /api/v1/tasks/:id/watch   (204)
GET    /api/v1/tasks/:id/watchers            GET /api/v1/me/watching   (own only)
GET    /api/v1/projects/:slug/mentionable    who an @mention resolves for (4.19) —
                                             members plus org owner/admin, who hold
                                             implicit lead and have no membership row
POST   /api/v1/tasks/:id/dependencies        body { blocked_by_task_id }  — the path keeps the
                                             collection noun on purpose (§4.5, D-044)
DELETE /api/v1/tasks/:id/dependencies/:depId
GET    /api/v1/tasks/:id/comments            POST /api/v1/tasks/:id/comments
PATCH  /api/v1/comments/:id                  DELETE /api/v1/comments/:id
GET    /api/v1/projects/:slug/activity       GET /api/v1/activity    (org-wide, viewer+)
GET    /api/v1/tokens                        POST /api/v1/tokens     DELETE /api/v1/tokens/:id
GET    /api/v1/users/:id/tokens              DELETE /api/v1/users/:id/tokens/:tokenId  (admin+)
POST   /api/v1/heartbeats                    202, token auth only
GET    /api/v1/presence                      GET /api/v1/capacity
GET    /api/v1/unlisted                      ?user=&since=  — work logged outside any project
POST   /api/v1/unlisted/:id/promote          body { project_slug, title, priority? } → creates a task
DELETE /api/v1/unlisted/:id                  dismiss
GET    /api/v1/projects/:slug/metrics        ?window=  — throughput, cycle time, stuck, WIP by user
GET    /api/v1/events                        SSE, ?project= optional
GET    /api/v1/projects/:slug/meeting-reviews
GET    /api/v1/meeting-reviews/:id           one review with its full proposal set and quotes
POST   /api/v1/meeting-reviews/:id/apply     body { accepted_proposal_ids[] }
POST   /api/v1/meeting-reviews/:id/discard   reject the whole set without applying anything
POST   /webhooks/github                      POST /webhooks/transcript
GET    /api/v1/health
```

`PATCH /tasks/:id` accepts a partial
`{ title, description_md, status, assignee_id, priority }`; a status change
writes `task.status_changed` with `{ from, to }`.

---

## 7. MCP endpoint

Served by the same process at **`/mcp`** (Streamable HTTP transport). Auth is a
personal access token as `Bearer`, identical to §6.1.

**Every tool acts as the token's user.** No service account, no elevated mode, no
bypass. Each tool is a thin wrapper over the same service layer the REST routes
use: same `assertCan`, same `activity` row (with `actor_kind: agent`, which is how
the UI badges it), same SSE event. If an agent can do something in Laika, it is
because its human could.

Responses use **display keys** (`LAI-42`), not raw ULIDs, wherever a human will
read them.

### 7.1 Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `laika_whoami` | `{}` | the identity this token acts as — `user_id`, `name`, `email`, `org_role`, `token_scope`. Reads nothing, changes nothing |
| `list_projects` | `{}` | projects the user can read |
| `list_ready_tasks` | `{ project?, limit? }` | ready tasks exactly as §4.5 derives them — **unassigned** and unblocked — sorted p1→p3 then age |
| `get_task_context` | `{ task }` | task, description, `blocked_by` + their statuses, comments, recent activity, branch, `discovered_from` chain |
| `get_project_context` | `{ project }` | `context_md`, its recent edit history, open-task summary, members + roles |
| `create_task` | `{ project, title, description?, priority?, blocked_by?, discovered_from? }` | created task, `created_via: 'mcp'` |
| `start_working` | `{ task, branch? }` | task, or `409` with the current assignee |
| `update_status` | `{ task, status, note? }` | task; validated transition |
| `add_comment` | `{ task, body }` | comment |
| `finish_task` | `{ task, summary, checklist? }` | task → **`review`**, summary posted as a comment |
| `log_unlisted_work` | `{ repo, note }` | records work or an idea outside any project, for triage |

`get_task_context` and `get_project_context` are deliberately **fat** — one call
returns everything needed to start, because round-trips are expensive for an
agent.

**Two corrections to this table, 2026-08-31 (LAI-139), found by building it.**

**`list_ready_tasks` said "assigned to me or unassigned".** That describes an
empty set: §4.5 derives `ready` as `status IN ('backlog','todo') AND assignee_id
IS NULL AND every dependency is 'done'`, so a ready task is *by definition*
unassigned and "assigned to me" can never match one. §4.5 wins, because **`ready`
is one derived concept shared by this tool and the board's Ready column** — §4.5
says so in the same breath — and a tool that returned more than the column shows
would be a second, quieter definition of readiness. An agent looking for work it
already holds is a different question, answered by `get_task_context` and by the
plugin's `/laika:standup` (§8), not by widening this.

**`get_project_context` said "last 10 decisions".** Laika has **no decision
entity** — no table, no verb, no endpoint — and §7.3 is explicit that decisions
live *inside* `context_md`, appended with their date by §10.2's meeting path. So
`context_md` already carries them, and a separate `decisions` field could only be
a markdown-parsing guess at structure the data does not have. The tool returns
the document's own **edit history** instead, which is what §7.3 actually asks for
— *"a reviewer can see what changed between two agent sessions"* — named for what
it is rather than for what it was hoped to be.

**Both were found by a builder who filed them instead of picking a side.** A
contradiction in this document must not be settled by whichever half someone
implemented first.

### 7.2 Tool contract

- **Guardrail: tools never bulk-mutate.** One task per call.
- **`log_unlisted_work` is the one tool with no REST twin, deliberately** (D-024).
  Every other tool wraps a service a route also calls. Unlisted work is *by
  definition* something an agent noticed outside any project — a human at the
  board would file a task instead — so there is no human write path to mirror.
  Humans read it (`GET /api/v1/unlisted`) and act on it
  (`POST /api/v1/unlisted/:id/promote`). The parity tests of §13.3 therefore
  cover the ten tools that have twins; this one is exempt, and **the exemption is
  named**, so the missing pair reads as intended rather than as a gap. *(This
  sentence deliberately carries **one** number and not two: it said "nine … a
  missing tenth" until LAI-433, and the guard pins only the first, so moving one
  and not the other would have left the sentence contradicting itself with
  nothing to catch it.)*
- **`laika_whoami` has no twin of its own and is paired with `GET /api/v1/me`**,
  which answers the same question with more of it. It exists so an operator whose
  token is misbehaving can establish *who the board thinks they are* before
  debugging anything else — the first question, and the hardest to answer from a
  failing tool call. It writes no `activity` row, because it reads nothing.
- `finish_task` stops at `review` by design — agents do not close their own work.
- Inputs are zod schemas exported as JSON Schema; unknown fields are rejected.
- Errors are MCP tool errors carrying the §6.3 `code`, so an agent can branch on
  `conflict` versus `forbidden` rather than parse prose.
- Read tools never mutate — including `last_used_at`, which is throttled.
- Responses pair compact markdown with a structured payload: readable when the
  model reasons over it, parseable when it does not.

### 7.3 The shared project context document

`projects.context_md` (§4.3) is a first-class product feature, not a description
field. It is the answer to every teammate maintaining a private `NOTES.md` and
re-explaining the same architecture to their own agent, differently.

**What it is.** One markdown document per project, edited by project `lead` or
org Admin/Owner through `GET`/`PATCH /api/v1/projects/:slug/context`, and served
to **every** agent session on that project by `get_project_context`. Write it
once, and every teammate's agent has it.

**What belongs in it**: architecture and conventions a new session must know,
decisions already made and closed, glossary and domain terms, things deliberately
not done and why. **What does not**: anything task-specific (that is the task
body), anything secret (it is served to every project member's agent), and
anything that changes per-session.

**Requirements.**

- `get_project_context` returns `context_md` verbatim alongside the last 10
  decisions, open-task summary, and members with roles (§7.1).
- Every edit writes an `activity` row, so the document has a history and a
  reviewer can see what changed between two agent sessions.
- Editing is `lead`+ (§3.2). Reading follows project read access — a `viewer`
  sees it.
- Accepted `decision` proposals from a meeting diff append to it with the date
  (§10.2). That is the mechanism that keeps it current instead of stale: the
  document is *fed* by the meeting path rather than maintained by discipline.
- Size is bounded and the bound is enforced at write time with a clear error;
  a context document that silently blows an agent's context window is worse than
  no document. **The limit is 100,000 characters**, enforced in the service so
  that every entry point — REST and MCP alike — shares one rule, and exceeded
  with a `422` naming both the limit and the actual length (LAI-404; this closes
  §14 q7).
- `updated_at` and `updated_by` are read from the document's own `activity`
  history, **not from `projects.updated_at`** — renaming a project must not look
  like editing its brief. A document never edited reports `null`, which is the
  honest answer rather than a convenient one.

---

## 8. Plugin and hooks

The shipped Claude Code plugin (`plugin/`, SHELL) is thin on purpose: it
carries no business logic, only wiring.

**Environment**: `LAIKA_URL`, `LAIKA_TOKEN`, written by `/laika:setup` into user
settings. Never committed; committed files carry obvious placeholders.

**Heartbeat hook** — on `SessionStart`, on `Stop`, and at most every 5 minutes
while active (throttled `PostToolUse`):

```bash
curl -s -X POST "$LAIKA_URL/api/v1/heartbeats" \
  -H "Authorization: Bearer $LAIKA_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"repo\":\"<git remote get-url origin, verbatim>\",\"branch\":\"<git branch>\"}" || true
```

**The hook does not parse the remote.** It sends what git printed; §9.1
normalises it. This line said *"git remote basename"* until LAI-144 — a basename
(`Laika`) matches nothing §4.3 stores, and it is where the defect came from.

**`|| true` is mandatory.** A board that is down, slow, or unreachable must never
break a coding session. Every hook fails silent.

**Commands**: `/laika:setup`, `/laika:status` (own capacity), `/laika:tasks`
(`list_ready_tasks`), `/laika:standup` (own activity, last 24h).

**Skill**: teaches claim-before-code, `finish_task` → `review`,
`discovered_from`, and `log_unlisted_work`.

The plugin must **load cleanly when unconfigured** — degrade with a clear
message, never fail to load.

---

## 9. Presence and capacity

### 9.1 Heartbeats

`POST /api/v1/heartbeats`, body `{ repo, branch }`, token auth only, responds
`202`. Sent by the plugin (§8) and optionally by a human's editor integration.

**Metadata only** (D-005). This is the one place where a tempting feature would
cost the trust the product is built on.

**A `repo` may match zero, one or several projects** (LAI-116). §4.3's `repo` is
not unique — a monorepo tracked by a frontend project and a backend project over
one repository is a real arrangement (LAI-108) — so the mapping is **resolved,
not looked up**. Comparison is case-insensitive: §4.3 stores what it was given,
so a project holding `PawanSirsat/Laika` matches a plugin reporting
`pawansirsat/laika`.

**A `repo` is normalised before it is compared, on both sides** (LAI-144,
D-043). `owner/name`, `git@host:owner/name.git`, `https://host/owner/name`,
`ssh://` and `git://`, with or without `.git` and a trailing slash, all mean the
same repository and all resolve to `owner/name`. **The server does this, and the
plugin sends what git gave it** — the server is the only side that can be fixed
after a client ships, and a self-hosted board controls nobody's plugin version.

Both sides are normalised, not only the incoming one: §4.3 asks for `owner/name`
and nothing enforces it, so a project row holding a URL is exactly as likely as a
heartbeat carrying one. A nested path is kept whole — GitLab subgroups are real,
and truncating to two segments would merge two different repositories. Anything
with nothing left after stripping matches nothing, per §9.2.

Several matches are narrowed by the branch, using **§9.2's project-prefix
convention** — `api-42-add-crud` on a repo tracked by `WEB` and `API` resolves to
`API`. When the branch says nothing, the heartbeat is attributed to **every**
match: a person working in a monorepo genuinely is present on both projects, and
attributing to nobody would make presence empty for exactly the arrangement §4.3
permits. A repo no project tracks is accepted and attributed to none — §9.2's
rule that unmatched input degrades and never errors applies here too.

### 9.2 Branch names carry task ids

Convention **`lai-<number>-<slug>`** — `lai-42-add-task-crud`. The server matches
`[a-z]+-(\d+)` case-insensitively against project prefixes, resolves the task, and
stores `matched_task_id` on the heartbeat and `branch` on the task.

**Resolution is server-side**, always: the plugin cannot know a deployment's
project prefixes. Anything unparseable is kept as a plain branch string — it
degrades, it never errors.

### 9.3 Derived views

Presence and capacity attribute a heartbeat to a project by **§9.1's rule, at
request time**. Nothing is stored on the heartbeat — consistent with there being
no separate presence store to fall out of sync, and a single column could not
hold a result that is legitimately many.

- **Presence** (`GET /api/v1/presence`) — users with a heartbeat in the last 5
  minutes. "Who is working right now."

  **Where is shown only to a reader who can see it** (LAI-438). `repo`, `branch`,
  `project_ids` and `matched_task_id` are present when the heartbeat attributes
  to a project that reader may read, and **absent otherwise** — including when it
  attributes to no project at all. The entry still names the person, the time and
  whether it is an agent: **it says somebody is working, without saying where.**

  This is not caution for its own sake. **D-046 puts `LAIKA_URL` and
  `LAIKA_TOKEN` in user settings, not per-repository**, so the hook fires in
  *every* repository a person opens — not the org's. Publishing each one to the
  whole org would make consent to be seen working on this board into consent to
  broadcast the name of everything else. **A task id names the work as surely as
  a repo names the place**, so all four fields follow one gate.

  §4.2's `presence_enabled` remains the org-level switch and is a different
  question: whether anything is recorded at all.
- **Capacity** (`GET /api/v1/capacity`) — per user: `active_sessions`,
  `in_progress_tasks[]`, `last_seen`, oldest in-progress age, tasks in review
  awaiting them, and `unlisted[]` from `log_unlisted_work`. Answers "who takes
  the next thing" and "what is stuck with nobody on it".

Both are computed from `heartbeats` + `tasks` at request time. No separate
presence store to fall out of sync.

---

## 10. Webhooks and the meeting diff

Mounted at `/webhooks/*`, outside `/api/v1`, no user session.

### 10.1 `POST /webhooks/github`

HMAC-SHA256 verified against the org's webhook secret (`X-Hub-Signature-256`),
constant-time compared, **before the body is parsed**. Unverified requests get
`401` and are logged as `webhook.received` with `verified: false`.

Handled: `push` (branch → task, `webhook.commit` activity), `pull_request`
(opened → link PR and move `in_progress`; merged → move to `review`),
`issue_comment` (mirror to task comments). Everything else is acknowledged and
ignored. Delivery ids are deduplicated for 24h.

### 10.2 `POST /webhooks/transcript`

Body `{ project_slug, transcript, source }` → `202`, creating a
`meeting_reviews` row.

The org's LLM provider (§12) receives: the transcript, the project's open tasks
(key, title, status, assignee), and the current `context_md`. It must return
**strict JSON**:

```json
{ "proposals": [
  { "kind": "new" | "change" | "dead" | "decision",
    "task": "LAI-42", "title": "...", "description": "...",
    "changes": { "status": "done" }, "reason": "...", "quote": "..." }
]}
```

**The server assigns each proposal a stable id when it stores `proposals_json`;
the model does not supply one** (D-024). `POST /meeting-reviews/:id/apply` takes
`{ accepted_proposal_ids[] }`, and those ids have to survive the round trip from
review screen back to server — so they cannot come from a model that has no
reason to make them unique or stable, and re-deriving them by array index breaks
the moment a proposal set is re-generated. Ids are assigned once, at store time,
and are opaque to the model.

Every proposal renders in the review screen **with its transcript quote**, so a
human can see what the model was reacting to.

**Nothing applies without explicit human acceptance.** `POST
/meeting-reviews/:id/apply` takes `{ accepted_proposal_ids[] }`; only accepted
items mutate anything, each `assertCan`-checked as if the reviewing human made
the change by hand, landing as normal activity with `created_via: 'meeting'`.
Accepted `decision` proposals append to `context_md` with the date.

This is the one place an LLM writes to the board, and it is gated by a human.
That gate is a product requirement, not a v1 shortcut.

---

## 11. Stack and runtime

### 11.1 One process

A single Node process (Node 22 LTS) serving the API, MCP, webhooks, SSE, cron and
the static SPA. No queue, no worker, no Redis, no sidecar (D-002).

### 11.2 HTTP — Hono

Hono on `@hono/node-server`. Fixed middleware order:
`requestId → logger → cors → bodyLimit → auth → rateLimit → route → errorHandler`.
Routes are grouped modules; handlers stay thin, logic lives in service modules
that take an `Actor` — which is what lets MCP tools reuse them exactly.

### 11.3 Persistence — SQLite + Drizzle

`better-sqlite3` in **WAL** mode, `foreign_keys=ON`, `busy_timeout=5000`,
`synchronous=NORMAL`. Database at `$DATA_DIR/laika.db`.

**All access through Drizzle** — schema, queries, migrations. Migrations are
generated files, committed, applied on boot, forward-only. Multi-table writes run
in a transaction. No raw SQL in handlers; the only exception is the `PRAGMA`s
above, at startup.

Auth is **better-auth** with the Drizzle adapter — email+password and invite
acceptance for v1, its tables alongside ours in the same database.

### 11.4 Frontend — React + Vite

React 19 + TypeScript + Vite, built to static assets served by the same process
from `server/public/`. SPA fallback to `index.html` for anything that is not
`/api/*`, `/mcp*` or `/webhooks/*`. It talks to the same public `/api/v1` an
agent does — no private endpoints, which keeps the API honest.

#### 11.4.1 Board views

Two views over the same task list, same filters, same URL state — a view is a
rendering choice, never a different query path.

**Kanban** (default). Columns by status: `backlog`, `todo`, `in_progress`,
`review`, `done`. `cancelled` is hidden behind a filter, not a column.

- Dragging a card between columns issues `POST /api/v1/tasks/:id/status` and is
  subject to the same transition validation as any other caller (§5) — an
  illegal drag snaps back and surfaces the error, it does not optimistically lie.
- Cards show: display key (`LAI-42`), title, assignee, priority, a **blocked**
  marker when any dependency is unfinished, a **ready** marker when §4.5 holds,
  and a **stale** marker once `stale_flagged_at` is set.
- Agent-authored recent activity is badged on the card (`actor_kind: 'agent'`).
- Column order and the `ready` marker are both **derived** — never stored, never
  cached client-side beyond the current response.

**List.** The same tasks as a sortable, densely readable table: key, title,
status, assignee, priority, dependency count, updated. Sortable on every column,
multi-filter on status / assignee / priority / ready / blocked. This is the view
for triage and for boards too large to drag.

Both views:

- share one filter state, reflected in the URL so a filtered board is linkable;
- update live over SSE (§11.5) rather than polling;
- paginate through the same cursor API (§6.3) — the kanban board loads per
  column, and a column with more results says so rather than silently truncating.

**Explicitly not in v1:** swimlanes, WIP limits, custom columns, saved views,
bulk edit. Columns are the status enum; when that is not enough, use the list.

#### 11.4.2 UI screens → API coverage

Every screen and the endpoints it cannot function without, checked against
`docs/design/Laika Prototype.dc.html` (the canonical mockup — see
`docs/design/README.md`).

**The build rule:** a UI task carries `depends-on` for the API task(s) that
define its endpoints, so no screen is built against an API that does not exist
yet. A screen whose endpoints are undefined is **blocked**, not "start it and
stub the data" — a stubbed screen is a screen that ships with the stub still in
it (D-012).

MCP tools appear where a tool *writes* the data the screen reads. Screens never
call MCP; agents do.

| Screen | Phase | REST endpoints it needs | MCP tools feeding it | Coverage |
| --- | --- | --- | --- | --- |
| **First boot** | 1 | `GET /setup/status`, `POST /setup`, `GET /health` | — | ✅ |
| **Login & invite** | 1–2 | `POST /auth/*`, `GET /invites/:token`, `POST /invites/accept`, `GET /me` | — | ✅ |
| **Projects** | 2 | `GET/POST /projects`, `GET/PATCH /projects/:slug`, `POST /projects/:slug/join`, `GET/POST/PATCH/DELETE /projects/:slug/members` | `get_project_context` | ✅ |
| **Board** | 2 | `GET/POST /projects/:slug/tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/claim`, `POST /tasks/:id/status`, `GET /projects/:slug/members`, `GET /events` | `create_task`, `start_working`, `update_status`, `finish_task` | ✅ |
| **Task detail** *(slide-over on Board, not a nav item)* | 2 | `GET/PATCH /tasks/:id`, `GET/POST /tasks/:id/comments`, `PATCH/DELETE /comments/:id`, `POST/DELETE /tasks/:id/dependencies`, `GET /projects/:slug/activity` | `add_comment`, `get_task_context` | ✅ |
| **Sprints** | 2 | `GET/POST /projects/:slug/sprints`, `GET/PATCH/DELETE /sprints/:id`, `POST /sprints/:id/tasks`, `DELETE /sprints/:id/tasks/:taskId`, `GET /projects/:slug/tasks?sprint=` | — | ✅ D-013 |
| **Timeline** | 2.5 | `GET /projects/:slug/timeline`, `GET/PATCH /sprints/:id` | — | ✅ D-014 |
| **Tokens** | 3 | `GET/POST/DELETE /tokens`, `GET /users/:id/tokens`, `DELETE /users/:id/tokens/:tokenId` | — | ✅ |
| **Organisation** | 1 basic / 6 LLM | `GET/PATCH /org`, `GET /users`, `PATCH /users/:id`, `GET/POST /invites` | — | ✅ |
| **Capacity** | 5 | `GET /capacity`, `GET /presence`, `GET /unlisted`, `POST /unlisted/:id/promote`, `DELETE /unlisted/:id`, `GET /events` | `log_unlisted_work` | ✅ |
| **Dashboard** | 5 | `GET /projects/:slug/metrics`, `GET /activity`, `GET /projects/:slug/activity` | all, indirectly via `activity` | ✅ |
| **Meeting review** | 6 | `GET /projects/:slug/meeting-reviews`, `GET /meeting-reviews/:id`, `POST /meeting-reviews/:id/apply`, `POST /meeting-reviews/:id/discard` | — | ✅ |
| **Laika Assistant** | 6 | *undefined — three questions first (§14, q9)* | — | ⏸ scheduled, unspecified |
| **Calendar** | ? | *none defined* | — | ⛔ **no decision — §14, q10** |

**Thirteen surfaces, not ten.** The prototype has thirteen render branches. Two
were never in any plan: **Task detail** (a slide-over reached from the Board, so
it is part of the Board's work, not a separate route) and **Calendar** (a real
nav item with no decision, no endpoints, and no entry in `FEATURES.md`). Calendar
is blocked until §14 q10 is answered.

#### 11.4.2.1 Must-have elements per screen

The minimum for a screen to be considered built. Anything beyond this is welcome;
anything missing sends the task back.

- **First boot** — owner name/email/password with confirm and strength meter; org
  name; optional first project; system status showing **SQLite, migrations
  applied, SMTP state** (never Postgres — see `docs/design/README.md`); presence
  opt-in toggle; single-use guarantee visible.
- **Login & invite** — sign-in form with instance host always visible; invite
  accept showing inviter, org, **pre-assigned role and what it permits**, and
  expiry; wrong-credentials error with attempts remaining; invite-expired state;
  instance-unreachable state. No "Forgot?", no magic link (§14, q11).
- **Projects** — project cards with name, repo, visibility badge, task counts,
  progress bar by status, member avatars, live-agent indicator, blocked count,
  last activity; Open board vs Join for public projects; empty state; first-run
  state.
- **Board** — five columns (`backlog`, `todo`, `in_progress`, `review`, `done`)
  with counts; cards showing key, title, assignee, priority, **blocked / ready /
  stale markers**; drag between columns issuing a real status call with snap-back
  on rejection; filters by assignee/priority/ready; live update over SSE;
  agent-authored badge; empty column states.
- **Task detail** — description, dependencies with **BLOCKED BY** relations and
  their statuses, comments distinguishing human from agent, activity trail,
  `created_via` provenance, claim/status controls, `discovered-from` link.
- **Sprints** — sprint list with dates, goal and status; active-sprint emphasis;
  task assignment in and out; counts by status; the one-active and no-overlap
  rules surfaced as errors, not silent failures.
- **Timeline** — one bar per sprint across a time axis, today marked, past
  dimmed; task counts per bar; unscheduled tray; drag an edge to reschedule with
  overlap rejection. **No per-task bars** (D-014).
- **Tokens** — create with name and scope; **value shown exactly once** with a
  copy affordance and an explicit "you will not see this again"; list with
  prefix, scope, last used, expiry; revoke with confirmation; admin view of
  another user's tokens.
- **Organisation** — org name; AI provider config showing `configured / provider
  / key_last4` and **never the key**; invites with role at invite time; member
  list with role controls; danger zone gated to Owner.
- **Capacity** — who is active now with repo, branch and resolved task; agent
  sessions distinct from humans; in-progress work across projects; last seen;
  **unlisted work with one-click promote to a task**; disabled state when
  `presence_enabled = 0`.
- **Dashboard** — progress by status; activity feed with an **agent/human
  filter**; stale warnings; throughput and cycle time; read-only for Viewer.
- **Meeting review** — transcript on one side, proposals on the other tagged
  **NEW / CHANGED / DEAD / DECISION**; each proposal shows its transcript quote;
  per-line accept and reject; apply acts only on accepted items; discard the set.

#### 11.4.3 Timeline view

A Gantt-style view of the project's schedule, drawn **entirely from sprint
boundaries** (§4.15). Phase 2.5, immediately after sprints land.

- The horizontal axis is time; each **sprint** is one bar, spanning `starts_on`
  to `ends_on`. Because sprints of a project may not overlap (§4.15), the axis is
  a single clean track — no lane-packing, no layout solver.
- Each bar shows the sprint's name, goal, and task counts by status, so progress
  is legible without expanding it.
- Expanding a sprint lists its tasks. **Tasks have no bars of their own** — they
  have no dates. A task inherits its sprint's span visually and nothing more.
- Tasks with `sprint_id IS NULL` appear in an unscheduled tray beside the axis
  and can be dragged into a sprint, which is
  `POST /api/v1/sprints/:id/tasks` — the same endpoint the Sprints screen uses.
- Dragging a sprint edge is `PATCH /api/v1/sprints/:id` on `starts_on` / `ends_on`,
  and is rejected if it would overlap a neighbour.
- Today's date is marked. Sprints entirely in the past are dimmed, not hidden.

**The constraint that keeps this cheap:** the timeline is a *sprint* chart, not a
*task* chart. The moment a task gets its own start and end date, this becomes a
dependency-aware Gantt with a layout engine, a critical path, and a scheduling
model — weeks of work and a permanent maintenance burden. Per-task planned and
due dates remain a §1.1 non-goal specifically to protect that boundary
(**D-014** — read it before adding a date column).

### 11.5 Live updates — SSE

`GET /api/v1/events` (D-003). One `text/event-stream` per client, filtered
server-side to the projects that actor may see, emitting `activity` rows.
`?project=<slug>` narrows it further.

#### The wire format

Written down because it was invented in the implementation and existed only
there — D-011 makes the spec authoritative, and an undocumented format is not.
`server/test/http/routes/events.test.ts` asserts every clause below.

**Activity frames are named after the §4.8 type** — `event: task.created`. A
client uses `addEventListener` per type, so **`onmessage` never fires**. That
trade is deliberate: it lets a client subscribe to one kind of change rather than
switching inside a single handler, and it is the single thing most likely to cost
an afternoon if unstated.

**Control frames use a name with no dot** — `ready`, `gap`, `closing`. Every name
in §4.8's closed vocabulary contains one, so the two can never collide and a
client can tell them apart without a list.

**Only activity frames carry `id:`.** A control frame is not a position in the
log and must never move the client's resume point.

| Frame | When | Body |
| --- | --- | --- |
| `ready` | first, always | `{ seq, project_id }` — where the stream is starting |
| `<§4.8 type>` | an activity row the actor may see | the row, §6.3-cased, with `actor_kind` |
| `gap` | the client asked to resume from too far back | `{ reason, missed, limit, updated_since }` |
| `closing` | graceful shutdown (LAI-002) | `{ reason: 'server_shutdown' }` |

**Resuming.** No `Last-Event-ID` starts at the head and replays nothing — a page
that has just loaded its state over REST does not want it replayed at it. With
one, the server replays what was missed, up to **500 rows** (`MAX_REPLAY`). Past
that it sends `gap` with the exact `?updated_since=` value to catch up with
(§6.3) and then goes live. **The limit is a memory bound as much as a policy
one**: every replayed row is buffered until the client reads it, so an unbounded
replay is an unbounded allocation triggered by a header the client controls.

An id from *ahead* of the log — a restored backup, or a client that kept an id
across a database replacement — returns `gap` with `reason: unknown_last_event_id`
rather than pretending the client is up to date.

**Keepalive** is a comment frame every **25 seconds**, so a proxy does not call
an idle stream dead. The server sends `retry: 3000` once, on the first frame,
rather than trusting every client's default.

**Backpressure.** At **1000** unwritten frames the connection is dropped; the
client reconnects with its last id and misses nothing. A paused tab is
disconnected rather than buffered indefinitely.

**`closing` means a deploy, not a fault.** A client should reconnect rather than
show an error.

**An open stream re-reads its actor.** Streams outlive role changes, so a
demotion or deactivation takes effect on the next batch — without this it is the
one place in the API where a permission change would not apply.

### 11.6 Scheduled work — in-process cron

One interval-driven scheduler in the same process:

- nightly SQLite snapshot to `$DATA_DIR/backups/`, keep 14
- heartbeat retention — delete older than 30 days
- **stale-task flagging** — `in_progress` with no heartbeat or commit for 3 days
  sets `stale_flagged_at`
- invite expiry, meeting-review expiry (7 days)
- weekly vacuum

Jobs are idempotent and write to `activity` only when they change something.

### 11.7 Environment and ops

**Naming rule (D-018):** anything Laika-specific carries the `LAIKA_` prefix.
`PORT`, `HOST` and `NODE_ENV` do not — they are universal conventions and
prefixing them would surprise. The prefix is collision safety: `DATA_DIR` and
`SERVER_SECRET` are generic enough to already mean something else in a shared
compose file or systemd unit.

| var | default | notes |
| --- | --- | --- |
| `PORT` | `3000` | universal convention, unprefixed |
| `HOST` | `0.0.0.0` | universal convention, unprefixed |
| `NODE_ENV` | `production` | universal convention, unprefixed |
| `LAIKA_SECRET` | **required — no default** | encryption key material (§12). **Minimum 32 characters**; a shorter value is a startup failure, not a warning, and the value is redacted from the error |
| `LAIKA_DATA_DIR` | `/data` | db, `backups/` |
| `LAIKA_DB_PATH` | `$LAIKA_DATA_DIR/laika.db` | |
| `LAIKA_PUBLIC_URL` | `http://localhost:$PORT` in development; **required in production** | invite links and webhook URLs — a localhost default that escapes into production sends people invite links they cannot open |
| `LAIKA_PUBLIC_DIR` | `server/public` | where the built SPA is served from. Primarily a test and packaging affordance; deployments do not normally set it |

**This table is the deployment contract.** Anything the server reads from the
environment belongs in it, and anything in it must be read. It drifted in both
directions before D-018 — `LAIKA_DB_PATH` and `LAIKA_PUBLIC_DIR` were read and
undocumented, while `DISABLE_INVITE_ONLY` was documented and unread — and that is
how an operator ends up setting a variable that does nothing.

**`LAIKA_SECRET` is required, never auto-generated (D-018).** Auto-generating it
hides the one decision an operator must actually make: a secret they never see is
a secret they never back up, and losing `$LAIKA_DATA_DIR` then destroys every
session and makes every `*_enc` column permanently undecryptable — silently, with
no error that says so. Refusing to start puts that choice in front of them once,
loudly, at the only moment it is cheap.

One Docker image, multi-stage (build SPA → build server → slim runtime), non-root
runtime user, one writable volume at **`/data`**. Back that up and you have backed
up Laika. TLS is somebody else's job — `docker/Caddyfile.example` ships as a
reference.

---

## 12. LLM provider

Org-configured, Admin+, one provider at a time:

- **`anthropic`** — API key.
- **`openai_compatible`** — base URL + optional key, covering Ollama and vLLM for
  fully local deployments.
- **`null`** — the default. Laika is fully functional without an LLM; only the
  meeting diff (§10.2) is unavailable.

Secrets are encrypted at rest with AES-256-GCM under a key derived from
`LAIKA_SECRET`, which is **required, has no default, and must be at least 32
characters** — a shorter value is a hard startup failure and the value is
redacted from the error message (§11.7, D-018). Ciphertext lives in `orgs.*_enc`; plaintext is never logged,
never returned by the API (the UI sees `{ configured: true, provider, key_last4 }`),
and never written to `activity`.

---

## 13. Cross-cutting

### 13.1 Security

Argon2id passwords (better-auth default); tokens hashed SHA-256 and shown once;
constant-time comparison for tokens and HMACs; CSRF on cookie-auth mutations;
`bodyLimit` on every route; zod validation at every boundary; security headers
(HSTS, `X-Content-Type-Options`, CSP with no inline script); no secrets in logs
or error responses.

### 13.2 Errors and logging

Structured JSON to stdout: `request_id`, `actor_id`, `actor_kind`, `token_id`,
method, path, status, duration. `request_id` is returned on 5xx so a user can
quote it. Unhandled errors return `internal` with no detail; detail goes to the
log.

### 13.3 Testing

Vitest. Unit tests for `can()` against §3.1 and §3.2; service tests against a
real in-memory SQLite with migrations applied; HTTP tests through Hono's test
client; and **parity tests** asserting an MCP tool and its REST twin produce
identical `activity` rows — for the nine tools that have a twin; `log_unlisted_work`
is exempt and §7.2 says why.

### 13.4 Privacy

**No telemetry. No analytics. No phone-home. No usage beacons.** Not opt-out —
absent. The only outbound calls Laika ever makes are to the org's configured LLM
provider (§12), configured SMTP, and a webhook source it was configured to talk
to. Any task proposing otherwise is rejected at review.

---

## 14. Open questions

Tracked here until decided; each becomes a `DECISIONS.md` entry.

1. Granular token scopes (`tasks:write`, `presence:write`, …) versus today's
   `full` / `read_only` + project restriction. Deferred until someone needs a
   token narrower than a role.
2. Per-project task templates — M2 or later?
3. Do we need a `blocked` status distinct from "has unfinished dependencies"?
   (Currently derived, not stored.)
4. Should `member` be able to assign work to *other* people, or is that
   `lead`-only on larger teams? (Currently allowed — optimising for small
   trusting teams.)
5. Task attachments / uploads — deferred; the `/data` volume anticipates them.
6. Multiple LLM providers configured at once (one for transcripts, one for
   summaries) — deferred past v1.
7. ~~**Size limit for `projects.context_md`** (§7.3).~~ **Answered
   2026-08-31: 100,000 characters** (LAI-404). Not a new number — it is what the
   zod schema had enforced since LAI-006, promoted into the service so both entry
   points share one rule. That promotion is the substance of the answer: an MCP
   tool reaches `updateProjectContext` without passing through zod, and **a bound
   only one entry point applies is not a bound**. Exceeding it is `422` naming
   the limit and the actual length.
8. **Manager dashboard metrics** — which numbers actually answer "where are we"?
   Throughput and cycle time are the obvious ones and may be the wrong ones.
   `GET /projects/:slug/metrics` (§6.4) reserves the surface; the payload is not
   yet defined. Needs shaping before M5.
9. **Laika Assistant — three questions, all due before Phase 6** (D-015). Until
   all three are answered the screen has no endpoints and cannot be scheduled
   into a task:
   1. **Read-only, or may it mutate the board?** If it mutates, D-007 binds it —
      it must propose and a human must accept, exactly like a meeting diff. A
      chat panel that writes directly is not compatible with this product.
   2. **Provider strategy.** The org's configured provider (§12), or its own? If
      the org has `ai_provider = null`, does the Assistant disappear, degrade, or
      block setup?
   3. **Context scope.** What does it see — one project, everything the actor may
      read, the whole activity log? This determines both the permission model and
      whether the context window is workable at all.

10. **Is there a Calendar screen?** The prototype's sidebar has
    `WORK → Calendar` with a real render branch, and nothing else in the plan
    mentions it — no decision, no endpoints, not in `FEATURES.md`. If it is a
    date-grid over sprints it is nearly free like the Timeline (D-014); if it
    implies per-task dates it reopens D-014. **Do not build it until this is
    answered.**
11. **Password reset and magic-link sign-in.** The login mockup shows "Forgot?"
    and "Email me a sign-in link". Neither exists in §6.1 or §6.4, and both need
    working SMTP. Either specify them (endpoints, token lifetimes, SMTP as a hard
    dependency) or cut them from the design. Currently listed as artifacts in
    `docs/design/README.md` and **not** to be built.

*(Questions about a Timeline date model and the sprints non-goal were resolved on
2026-08-24 — see D-013 and D-014.)*
