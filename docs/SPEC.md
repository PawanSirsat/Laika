# Laika — v1 Specification

Status: **authoritative for M1–M7** · Owner: CHIEF session · Last updated: 2026-08-24

This document is the source of truth. Builders implement exactly this; a
deviation requires a CHIEF-approved task that updates this file **first**. If the
code and this document disagree, that is a bug in one of them — raise it in your
log and CHIEF resolves it in `DECISIONS.md`. Do not silently diverge.

---

## 1. Product

Laika is a **self-hosted project board where humans and coding agents work from
one source of truth.**

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
deploys, **story points**, time tracking, and email as a *primary* interface
(transactional invite mail only).

**Changed 2026-08-24 (D-013, D-014).** "Sprints" and "Gantt charts" were on this
list and are not any more: sprints ship in Phase 2 (§4.15) and a **sprint-based**
timeline in Phase 2.5 (§11.4.3). *Story points* remain a non-goal.

**Changed 2026-10-06 (D-066).** *Per-task planned or due dates* were on this
list and are not any more: `tasks.due_on` and `tasks.planned_start` exist
(§4.5). D-014's cost — a task-dated timeline is a layout engine, not a
rendering pass — was put to the owner and accepted; **the timeline stays
sprint-based until a task makes it otherwise** (LAI-289). Tasks also carry a
one-level `parent_task_id` (subtasks). Epics, story points and attachments stay
out.

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
| View a member's profile | ✓ (session only) | ✓ (session only) | — | — |
| Set a member's profile kind | ✓ (session only) | ✓ (session only) | — | — |
| Rate a member | ✓ (session only, not themselves) | ✓ (session only, not themselves) | — | — |
| View a member's activity heatmap | ✓ (session only) | ✓ (session only) | — | — |
| Turn Developer insights on or off | ✓ (session only) | ✓ (session only) | — | — |
| Read own activity-sharing setting | ✓ | ✓ | ✓ | ✓ |
| Set own activity sharing | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Send own local activity | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
| Read and delete own local activity | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |

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

**The three profile rows are `profile.read`, `profile.set_kind` and
`profile.rate`** (D-078, LAI-743), behind §6.4's `/users/:id/profile` and
`/users/:id/ratings` and §11.4.2's member profile. Each is its own row, not a
borrow: the profile carries private ratings, which nothing about the member list
or an org role implies.

**"session only" means a signed-in web session and no personal access token** —
not an owner's or admin's full token, not a `read_only` one, not one pinned to
projects. Every other token rule narrows a role; this one closes the door,
because a token is how an agent acts and ratings are about people. `can()`
refuses it before scope is looked at, and `profile.read` is deliberately **not**
a read action in the `read_only` sense: no token may do it at all.

**"not themselves"**: an owner or admin cannot rate themselves. They may read
their own profile, ratings included, and set their own profile kind.

**The profile kind is a label, not a permission.** `builder` or `manager`
(§4.1) changes what the profile shows and nothing anybody may do: `can()` never
reads it, and no row of §3.1 or §3.2 depends on it.

**The activity rows are D-079's** (LAI-751): `profile.activity.read`,
`org.developer_insights.set`, `activity_sharing.read_own`,
`activity_sharing.set_own`, `local_activity.send_own`, and
`local_activity.read_own` with `local_activity.delete_own`. They sit behind
§6.4's `/people/:id/activity`, `developer_insights` on `PATCH /org`,
`/me/activity-sharing` and `/me/local-activity`.

- **The heatmap follows the profile.** Its own row rather than `profile.read`
  borrowed, because it carries counts sent from a developer's machine, which
  the rest of the profile does not — the same reasoning as the profile's own
  rows. Today the two answer alike.
- **The rest are the developer's own record about their own work**, the
  heartbeat's argument, so every role holds them. What stops collection is
  not the matrix: it is the two switches — the organisation's
  `developer_insights` (§4.2, its own row above) and the developer's
  `share_local_activity` (§4.1) — which the service reads on every report.
- **Both switches are a web session's.** `developer_insights` on `PATCH
  /org` is its own action, `org.developer_insights.set`, not *Org settings*
  borrowed: a token may hold `org.settings.edit`, and an owner's token must
  not be able to turn on the collection of anybody's work. A token's `PATCH
  /org` carrying `developer_insights` is refused `403` with `details.reason:
  "session_required"` and writes nothing, whatever else it carried (LAI-751
  review).
- **Consent, reading back and erasing are session only.** A token is how an
  agent acts, and an agent must not be able to turn sharing on for its
  person, read back what was collected, or wipe it. A token may read the
  setting — a collector asks before it sends — and send a report, so the
  Viewer's send cell is the credential's refusal, as for heartbeats.
- **A token refused only because a row is session only is told so**:
  `forbidden` with `details.reason: "session_required"` (§6.3), so a collector
  can tell *sign in to the web app* from *never*.

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


### 3.4 The system principal

Some writes have no person behind them: the in-process cron (§11.6) and a
verified webhook delivery (§10.1). §3.3 rule 1 admits no exception for them, and
rule 3 denies by default — so they act as a **named system principal** that
`can()` recognises explicitly (D-050).

**It is not a role and it is not a column in §3.1.** A role is something a person
holds; this is something no person can be granted. It holds exactly:

| Action | Why |
| --- | --- |
| `task.write` | §10.1: a merged pull request moves its task to `review` |
| `comment.create` | §10.1: `issue_comment` mirrors to task comments |
| `system.heartbeat.prune` | §11.6: retention |
| `system.task.flag_stale` | §11.6: stale flagging, both directions |
| `system.invite.expire` | §11.6 |
| `system.meeting_review.expire` | §11.6 |
| `system.local_activity.prune` | §11.6: local-activity retention (D-079) |

**Everything else is denied**, and `matrix.test.ts` asserts it cell by cell as it
does for §3.1 and §3.2.

**Scoped to one project** — the project a delivery resolved to (§9.2), or the
project a job is acting on. A delivery that resolves to no project writes
nothing.

**Authority is not attribution.** Rows written this way carry
`actor_kind: 'system'` and `actor_id: null` (§4.8); that is settled separately
and is unchanged by this section.

**`task.write` and `comment.create` are the human actions, not system twins.** A
webhook moving a task performs the *same operation* on the *same resource* a
person does; only the principal differs. Twins would be two rules for one
operation and eventually two answers.

**The four `system.*` actions are the ones with no human owner** — nobody expires
an invite through the API. §3.1 and §3.2 have no row for them, so the role
branches never see them and **deny-by-default does the work** rather than a
special case.

**`VACUUM` holds no action and needs none.** Rule 1 governs reading and writing
*data*; `VACUUM` rewrites storage and touches no row, so there is no resource to
name. A `system.database.vacuum` would be a permission that grants nothing.

### 4.1 `users`

| field | type | notes |
| --- | --- | --- |
| `id` | text pk | ULID |
| `email` | text unique | lowercased on write |
| `name` | text | |
| `org_role` | text | `owner` \| `admin` \| `member` \| `viewer` |
| `is_active` | integer | 0 = deactivated, row kept for history |
| `profile_kind` | text | `builder` \| `manager`, default `builder` — what the member profile shows (§11.4.2, D-078). **A label, never a permission**: `can()` does not read it (§3.1) |
| `share_local_activity` | integer | default **0** — the developer's own half of D-079's two switches: whether their collector may send local activity counts (§4.23, §4.24). Set only by them, from a web session (§3.1); off stops collection at once and deletes nothing |
| `local_activity_scope` | text | `agent-repos` \| `laika-repos`, default `agent-repos` — which repositories their collector counts in: every one where they run a connected agent on that machine, or only those set up for Laika. The server cannot see a repository; it stores the choice and the collector honours it (D-079) |
| `created_at`, `updated_at` | integer | |

**There is no `avatar_color` column** (LAI-148). This table listed one, *"derived
from id"*, and three places disagreed about it: the server derived it from
**email** and stored it, the client derived it from **id** at render and ignored
the stored value entirely, and better-auth's `additionalFields` supplied
`#6b7280` for any row created by a path that skipped the hook. **The served value
was never read by anything.**

Deriving at render is the only answer that satisfies §5.1's both-themes rule —
one stored colour cannot be legible in light and dark — so the column was the
mistake rather than the client, and **reading the served value would have been
the tempting one-line fix and the wrong one.**

Credentials, sessions and verification records belong to **better-auth's own
tables** (§11.3). Do not hand-write password or session columns.

### 4.2 `orgs` — exactly one row

| field | notes |
| --- | --- |
| `id`, `name` | |
| `owner_user_id` | |
| `invite_only` | integer, default **1** (D-004) |
| `presence_enabled` | integer, default **1** — org-wide off switch for heartbeats. When 0, `POST /heartbeats` returns `202` and discards, and Presence/Capacity show a disabled state rather than an empty one. D-005 makes the product's privacy claim; this makes it enforceable by the org, not just promised by us. |
| `developer_insights` | integer, default **0** — the organisation's half of D-079's two switches, set by owners and admins from a web session (*Turn Developer insights on or off*, §3.1). Off: no developer's local activity is accepted, whatever they chose, and the heatmap shows board actions only. Readable by everyone, for `presence_enabled`'s reason. |
| `ai_provider` | `anthropic` \| `openai_compatible` \| `null` |
| `ai_base_url` | **nullable** — for Ollama / vLLM; null means the provider's own default endpoint |
| `ai_api_key_enc` | **nullable** — AES-256-GCM, key derived from `LAIKA_SECRET` (§12). **Null is how "no provider configured" is recorded**; there is no separate flag, so §10.2 and the Assistant both read this column to decide whether they can run at all |
| `ai_key_last4` | the key's last four characters, **stored at set time, never derived** — building a response must not require decrypting the key (LAI-447) |
| `smtp_json_enc` | nullable, same encryption |
| `github_webhook_secret_enc` | nullable, same encryption |
| `transcript_webhook_secret_enc` | nullable, same encryption — **its own secret, not GitHub's** (D-052). One secret for two integrations means revoking either breaks both, and a leak of one hands over the other. |

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
| `status` | the **category** of the task's status: `backlog` \| `todo` \| `in_progress` \| `review` \| `done` \| `cancelled`. What §5, readiness, policy, metrics and every filter read. Kept in step with `status_id` by the services, and in SQL by the composite FK `(project_id, status_id, status)` → `project_statuses(project_id, id, category)` (D-077) |
| `status_id` | FK `project_statuses` (§4.20) — the project status the task is in, which is the board column it draws in. Served on `TaskView` with `status_name` beside it |
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
| `parent_task_id` | nullable self-FK, `ON DELETE SET NULL` — the task this is a **subtask** of (D-066). **One level**: a parent is never itself a child, and a task with children cannot be given a parent; the service refuses both `422`, as it refuses another project's task. Containment, not blocking — `ready` ignores it, and a parent's status is never moved by its children |
| `due_on` | nullable — integer unix-ms with **date-only semantics**, exactly as a sprint's `starts_on` (§4.15). A plan, not an actual; "overdue" is derived by the reader and never stored (D-066) |
| `planned_start` | nullable — same shape as `due_on`. Neither date is validated against the other |
| `branch` | nullable, last branch seen working on it |
| `external_ref` | nullable, e.g. a GitHub PR |
| `stale_flagged_at` | nullable, set by cron (§11.6) |
| `position` | nullable — **manual board order**, one sequence per project; a lane draws its tasks in this order (D-060, D-070). An opaque key compared byte-wise: set on create at the **end** of the project's order, moved only by `POST /tasks/:id/reorder`, which writes this one row. Nullable only so the column could be added to a populated table — the boot backfill fills every null in the order the board already showed (priority, then number), so a served task always has one |
| `started_at`, `completed_at` | nullable — **served on `TaskView`** (LAI-126). `started_at` is stamped the **first** time a task enters `in_progress`, by any route in — a claim after the task was released included (LAI-743) — and a later re-entry does not move it: a task sent back for rework did not start twice, and overwriting would silently shorten every cycle time derived from it (§11.6). |

**`started_at`** is set the first time a task enters `in_progress` and is never
moved again. **`completed_at`** is set on **every** arrival at `done`, and is
**not cleared** when a task is reopened: a task completed twice was completed the
second time, and a reopened task keeps the record of having been finished before.

**The two are deliberately asymmetric** — first for one, latest for the other
(LAI-146). A `completed_at` on a task that is not `done` is a fact about its
**history**; `status` is the only claim about its **state**.

**`started_at` and `completed_at` are actuals, not a plan.** `planned_start` and
`due_on` are the plan (D-066), and the two pairs are kept apart on purpose:
these record what *happened*; the dates assert what is *intended*. The timeline
still draws sprint boundaries — **drawing task bars from either pair is a
separate task** (LAI-289), not a UI change.

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

`parent_task_id` is a **third** relationship — containment (D-066). A subtask
belongs to its parent the way a checklist line belongs to a checklist; it is
worked and finished on its own, blocks nothing, and is blocked by nothing on
account of the parent. Progress (`n/m done`) is derived by the reader from the
children's statuses, never stored.

### 4.7 `comments`

`id`, `task_id`, `author_id` (**nullable**), `body_md`, `created_via` (same enum
as tasks), `edited_at` (**nullable** — null means never edited, and it is what
the UI reads to decide whether to show *"edited"*), `deleted_at` (**nullable**,
soft — null means not deleted, so **every read path must filter on it** and one
that forgets serves deleted comments), `created_at`, `updated_at`.

**A null `author_id` means the comment has no Laika author** (LAI-449) — it was
mirrored from somewhere else, and `created_via` says where. Today that is
`webhook`: §10.1 mirrors a GitHub `issue_comment`, whose writer has no account
here and, by **D-050**, no identity mapping to one.

**It is not "we cannot tell you who".** That is a different fact — a reader who
may not see an actor — and the two must not share a rendering that implies each
other. **Nobody wrote this** and **you may not know who** are both true
sometimes, and never the same time.

**A comment with no author can be edited or deleted by nobody.** §3.2's rows are
*own + any* and *own*; **neither is satisfiable by an absent author**, and a lead
holding *any* would otherwise fall through and be allowed. The refusal is
explicit and is a **conflict**, not a permission failure: the request does not
apply to this comment, whoever asks.

**A non-null `author_id` still references a real user.** Nullable is not
unconstrained.

A comment is served with **`sent_back`**, derived and never stored: `true` when
`task_reviews.comment_id` (§4.27) names it, because it is the reason a person
gave for sending the task back from review (D-081).

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
`heartbeat.pruned`, `invite.expired`, `meeting_review.expired`,
`meeting_review.discarded`.

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

**Subtasks and dates added no verb** (D-066, the same shape as tags, D-027).
`task.created` carries `parent_task_id` in its payload **only when set**, so a
top-level task's row is unchanged; setting, moving or clearing a parent, a due
date or a planned start is `task.updated` with the field named in `changed`.

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
| `project_ids_json` | **nullable, and `null` is the *wider* value** — an unscoped token reaches every project the user may reach. A JSON array scopes it to those projects and nothing else. **The absent value is the permissive one**, which is the opposite of the usual reading, so a migration or a bug that loses this column widens every token it touches. |
| `project_ids_json` | null = all the user's projects |
| `last_used_at`, `expires_at`, `revoked_at` | nullable |
| `last_mcp_at`, `last_client`, `last_client_name` | nullable (D-076). `last_mcp_at` is the last authenticated `/mcp` request, stamped at most once a minute like `last_used_at`. **Not stamped while §4.2's `presence_enabled` is off.** `last_client` is an `AGENT_CLIENTS` slug and `last_client_name` the client's own `clientInfo.name` (Unicode `Other` characters and line/paragraph separators stripped, at most 64 characters), both from the last `initialize` that named an agent: a generic name such as `mcp` fills a blank but never replaces a known client. Display and presence only; **never an authorisation input** |

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

`id`, `user_id`, `token_id` (**nullable** — null when the heartbeat came from a
signed-in session rather than a token, which is how a human's own editor is told
apart from an agent's), `repo`, `branch`, `matched_task_id` (nullable,
resolved server-side from the branch — §9.2), `created_at`.

**Metadata only**: repo name, branch name, timestamp. Never file paths, diffs,
prompts, or transcript content (D-005). Cron deletes rows older than 30 days.

**Heartbeats are not the only source of presence** (D-076). A token's
`last_mcp_at` (§4.9) also makes its user present, for the agents that send no
heartbeat. Nothing about that path is stored here.

### 4.11 `invites`

`id`, `org_id`, `email` (nullable for link invites), `org_role`, `project_id`
(nullable), `project_role` (nullable), `token_hash`, `created_by`, `expires_at`,
`accepted_by` (**nullable**), `accepted_at` (**nullable** — the pair is null
exactly while the invite is still pending, and **that is the only record of
pending there is**; there is no `status` column), `created_at`.

### 4.12 `meeting_reviews`

`id`, `project_id`, `source`, `transcript_hash`, `proposals_json` (§10.2),
`status` (`pending` \| `applied` \| `discarded` \| `expired` \| `failed`),
`reviewed_by`
(**nullable**), `reviewed_at` (**nullable** — both stay null for a review that
expired, because nobody reviewed it; `status` is what distinguishes *expired* from
*pending*, and the pair says **who acted**, never *whether the row is finished*),
`created_at`, `expires_at`. Proposals expire unreviewed after 7 days.

**`failed` means the provider was called and paid for, and its answer would not
parse** (D-057). The row carries `proposals_json` of `[]` — **the status is what
distinguishes it, not the emptiness**, because `{"proposals": []}` is a
legitimate answer from a meeting with nothing to propose. Without it the two are
the same row, and a reviewer reads *"the provider misbehaved"* as *"the meeting
was unproductive"*. A `failed` row **counts toward the monthly cap** (§10.2) and
is never reviewable; the expiry sweep only moves `pending`, so it cannot reach
one.

### 4.13 Indexes that must exist

`tasks(project_id, status)`, `tasks(assignee_id, status)`,
`tasks(project_id, updated_at)`, `tasks(project_id, number)` unique,
`task_dependencies(depends_on_task_id)`, `comments(task_id, created_at)`,
`activity(project_id, created_at)`, `activity(task_id, created_at)`,
`heartbeats(user_id, created_at)`, `tokens(token_hash)` unique,
`project_memberships(project_id, user_id)` unique, `projects(slug)` unique,
`unlisted_work(user_id, created_at)`, `meeting_reviews(project_id, status)`,
`sprints(project_id, starts_on)`, `sprints(project_id, status)`, `tasks(sprint_id)`,
`tasks(parent_task_id)`, `tasks(status_id)`,
`project_statuses(project_id, position)` unique, `member_ratings(user_id, created_at)`,
`board_activity_days(user_id, day)` unique, `local_activity_days(user_id, day, collector_id)`
unique, `local_activity_days(day)`, `pushed_commit_keys(user_id, key)` unique,
`pushed_commit_keys(user_id, day)`, `pushed_commit_keys(day)`. The heatmap's reads
are each a range of one person's days on an index that leads with the person;
retention deletes by `day` alone (§11.6).
`tags(project_id, name)` unique and `task_tags(tag_id)` — the `?tag=` filter
reads from the tag side, so the join needs an index from that end too.

### 4.14 `unlisted_work`

Appended after §4.13 rather than inserted before it, so the Indexes section keeps
its number (D-011 — LAI-003 cites `§4.13`).

`id`, `user_id`, `token_id` (**nullable**, same meaning as §4.10's), `repo`,
`note`, `promoted_task_id` (nullable), `dismissed_at` (nullable), `created_at`.

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

**Non-goal: hierarchy in tags.** Tags are flat. `priority`, `sprint_id`,
`discovered_from` and `parent_task_id` (§4.5, D-066) already carry the
structured groupings.

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

### 4.20 `project_statuses`

A project's own statuses — **one per board column**, the way a Jira
team-managed project has them (D-077, LAI-738). Each belongs to one of six fixed
**categories**, which are §5's statuses; a task's `status` (§4.5) is the
category of its `status_id`. A project names, orders and hides its statuses;
nothing that reasons about work — §5, readiness, policy, metrics, the stale
cron, MCP — reads anything but the category.

| field | notes |
| --- | --- |
| `id` | ULID |
| `project_id` | FK `projects` `ON DELETE cascade` |
| `name` | 1–40 characters, trimmed; unique per project, case-insensitively |
| `category` | `backlog` \| `todo` \| `in_progress` \| `review` \| `done` \| `cancelled` — fixed for the life of the row |
| `position` | integer, 0-based and dense, unique per project — the board's left-to-right order |
| `hidden` | 0/1 — holds work but draws no column; `cancelled`'s default |
| `created_at` | |

**Rules.**

- **Every project has at least one status in every category, always.** A new
  project gets Backlog, To do, In progress, Review, Done and Cancelled (hidden).
  Deleting the last status of a category is refused `409`. The `tasks` foreign
  key cannot express this; `deleteProjectStatus` is the only code that removes
  a row, and it holds the rule.
- **A category never changes.** `PATCH` refuses `category` with `422`; the move
  is a new status in the wanted category, then a delete of the old one into it.
- **Deleting a status moves its work first**, to `move_to` — another status of
  the same project. Across categories each task makes a real §5 status change,
  exactly as a drag would; within one it is a column change. If §5 refuses any
  one task, nothing moves and nothing is deleted.
- **A bare category means the project's first visible status of it** by
  position, or the first of any visibility when every one is hidden. That is
  where `status` on a create or `POST /tasks/:id/status`, the webhook (§10.1)
  and MCP's `update_status` land a task. **`claim` is the exception for a task
  already in progress:** it leaves the task in its current status — a claimed
  card in `Coding`, an `in_progress` status, stays there — and only a task coming from another
  category lands in the first visible `in_progress` status.

**This replaces LAI-266's `board_columns` and `board_column_statuses`**, which
modelled a column as a set of categories. Migration `0028` copied every board
into statuses and dropped both tables in the same migration: a one-status column
became a status with its name, place and hidden flag; a several-status column
gave its primary status the column's name and each other status its own,
default-labelled, straight after it; a category no column held became a hidden,
default-labelled status at the end; a clashing name took a ` (2)` suffix; an
empty column, which held no category, became nothing. Every task kept its
category, in the first status of it.

### 4.21 `member_ratings`

An owner's or admin's rating of one member, for the member profile (D-078,
LAI-743). **Append-only**: a new rating supersedes the last, never edits it, and
three triggers refuse `UPDATE`, `DELETE` and an `INSERT OR REPLACE` over an
existing id — re-established at every boot, as `activity`'s are. The third
exists because SQLite runs no `BEFORE DELETE` trigger for a replace's delete
half while `recursive_triggers` is off (LAI-746).

| field | notes |
| --- | --- |
| `id` | ULID |
| `user_id` | FK `users` — the person rated |
| `rated_by` | FK `users` — the owner or admin who rated them; never `user_id` (CHECK) |
| `score` | integer 1–5 (CHECK) |
| `note` | 1–500 characters, required — the reason, which is what makes a rating reviewable |
| `idempotency_key` | nullable — the `Idempotency-Key` the rating was sent with. A retry with the same key, from the same rater, answers from this row instead of writing another (§6.4, LAI-746) |
| `created_at` | |

**Private.** A rating writes no `activity` row and has no §4.8 verb, so it
reaches no feed, SSE stream, webhook or export, and no MCP tool reads it. It is
read back by `GET /api/v1/users/:id/profile` (§6.4), which answers an owner or
admin on a web session and nobody else (§3.1), and by a retried `POST` with the
same `Idempotency-Key`, which answers from this row after the same check. §6.3's
generic store leaves that route alone, so no copy of the note is kept in
`idempotency_keys` (LAI-746). No `ON DELETE`: people are
deactivated, never deleted (§4.1).

### 4.22 `board_activity_days`

One person's board actions per day — the heatmap's *Board* colour (§11.4.2,
D-079, LAI-751).

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade — the actor |
| `day` | `YYYY-MM-DD` in **UTC**. Laika has no organisation time zone; were one added, this is the column whose meaning would change |
| `by_self` | integer — `activity` rows they wrote on a web session (`actor_kind = 'user'`) |
| `by_agents` | integer — rows written with one of their tokens (`actor_kind = 'agent'`) |

Primary key (`user_id`, `day`).

**A rollup of §4.8, never a second source.** `appendActivity` adds one to the
actor's day in the same transaction as every row it writes — the one write path
into `activity` — and migration 0031 filled it from the log in one set-based
statement. System rows have no person and are not counted. It exists so that a
year of one person's days is at most 366 rows read through the key, whatever the
size of the log: no profile read scans `activity`.

### 4.23 `local_activity_days`

A developer's local work per day, as one machine last reported it (§6.4,
D-079, LAI-751) — the heatmap's *Local* colour.

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `day` | `YYYY-MM-DD` in the machine's own time zone, `tz` |
| `collector_id` | a random UUID v4 the collector made once on that machine. No hardware or user data in it |
| `prompts` | integer — prompts sent to agents that day, the sum of `prompts_by_agent` |
| `prompts_by_agent` | JSON `{ "<agent kind>": n }`, kinds folded onto §9.3's agent slugs; anything else is `other` |
| `sessions` | integer — agent sessions started |
| `commits_local` | integer — their commits that day on no remote yet; merge commits and commits authored before they turned sharing on are not counted (§6.4) |
| `tz` | the IANA zone the machine reported its days in |
| `updated_at` | integer — when this snapshot arrived |

Primary key (`user_id`, `day`, `collector_id`).

**Counts only** — there is deliberately no column that could hold a prompt, a
file name, a repository, a path, a remote, a branch, a commit message, an email
or a commit id. **A snapshot**: a report **replaces** the row for its (person,
collector, day), so a retry never double-counts and a commit pushed later
leaves `commits_local` on the next report. Machines sum. Kept 400 days (§11.6).

### 4.24 `pushed_commit_keys`

One key per commit a developer has on a remote — the heatmap's *GitHub* colour
(§6.4, D-079, LAI-751). Commits authored after they turned sharing on, and once
per repository a look-back of up to a year before that (D-080, LAI-757); never
a merge commit — the collector's rules (§6.4).

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `key` | the first 16 lowercase hex characters of `sha256("laika-commit:" + <40-hex commit id>)`. One-way: never the commit id |
| `day` | `YYYY-MM-DD`, the author's day on the machine that reported it — the **earliest** any machine reported |
| `created_at` | integer |

Primary key (`user_id`, `key`).

The same commit seen from two machines is one key, so it counts once. A report
adds keys and never removes one; a key already held keeps its earliest day. A
look-back report (§6.4) adds keys and nothing else, for days back to the 400
this table keeps. The
count is per person, by day, as distinct keys. Counted on the developer's
machine — no GitHub webhook and no call to GitHub (§13.4 is unchanged). Kept
400 days (§11.6).

### 4.25 `task_rounds`

One finish of a task — an agent handing it back for review — with what it says
it did (D-081, LAI-758). **A task has as many rounds as it was finished**:
finished, sent back and finished again is two rows, and the first is never
rewritten. Written only by `finish_task` and `POST /tasks/:id/finish` (§6.4),
inside the move to review.

| field | notes |
| --- | --- |
| `id` | ULID |
| `task_id` | FK `tasks`, cascade |
| `number` | 1 for the task's first finish, then 2, 3 … — unique per task (CHECK `>= 1`) |
| `finished_by` | FK `users` — the person whose credential finished it |
| `token_id` | nullable — FK `tokens`, `ON DELETE SET NULL`; null on a web session |
| `client_name` | nullable — the agent's own name for itself at the finish (D-076's `last_client_name`, or the token's name when the agent never sent `initialize`). A **copy**, because the token's current value says which agent connected last, not which one finished this round |
| `summary_md` | the summary and checklist, as posted in the round's comment |
| `created_at` | |

### 4.26 `task_evidence`

One item of a round's proof (D-081): a commit, the branch, the pull request or
a test run. **Each item carries its own `state`**, so step 2 (LAIKA-477,
GitHub confirming the proof) changes `state`, `state_source` and `state_at` on
a row and needs no migration.

| field | notes |
| --- | --- |
| `id` | ULID |
| `round_id` | FK `task_rounds`, cascade |
| `kind` | `commit` \| `branch` \| `pull_request` \| `test_run` |
| `position` | the order the agent sent the items in, from 0 |
| `value` | the sha (7–40 lowercase hex), the branch name, the pull request URL (`http:` or `https:` only) or the test command |
| `detail` | nullable — a commit's first line; null for every other kind |
| `exit_code` | nullable — a test run's exit code, required for one and null for every other kind (CHECK) |
| `state` | `claimed` \| `confirmed` \| `failed`, default `claimed` — what the agent said, until something other than the agent checks it. Every item is `claimed` today |
| `state_source` | nullable — what changed `state`, such as `github`. Null while `claimed` |
| `state_at` | nullable — when `state` last changed. Null while `claimed` |
| `created_at` | |

Indexed on `(round_id, position)` for the panel and on `(kind, value)` for
step 2, which knows a sha or a pull request, not a round. A round holds at most
50 commits and 50 test runs; a commit's first line is at most 200 characters, a
branch 200, a URL 500 and a command 500 (§6.4).

### 4.27 `task_reviews`

What a person did with a task waiting in review: **accepted** it or **sent it
back** with a reason (D-081, LAI-758).

| field | notes |
| --- | --- |
| `id` | ULID |
| `task_id` | FK `tasks`, cascade |
| `round_id` | nullable — FK `task_rounds`, `ON DELETE SET NULL`; the task's latest round when the decision was made, null when it reached review without a finish |
| `decision` | `accepted` \| `sent_back` |
| `reason_md` | nullable — required for a send-back and null for an accept (CHECK) |
| `comment_id` | nullable — FK `comments`, `ON DELETE SET NULL`; the comment a send-back's reason was posted as |
| `decided_by` | FK `users` |
| `created_at` | |

**A send-back is the task's current one** while it is the task's latest
decision, no round has been finished since — its `round_id` is still the
task's latest round — and the task is not done or cancelled. That is what
`TaskView.send_back` serves (§6.4) and what `get_task_context` reads first
(§7.1). The next finish retires it. A comment named by `comment_id` is served
with `sent_back: true`.

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

  **This restricts people. It does not restrict the system principal** (§3.4,
  D-051). The rule exists because *agents do not self-certify* — the bullet
  below — and a merged pull request is **external evidence, not an actor
  asserting its own work is complete**. §10.1's `pull_request` → merged →
  `review` is therefore a distinct path, not an exception: nobody with an
  interest in the outcome decided it.

  The three human answers stay exactly as they are. A system principal reaching
  this line is a verified webhook delivery on a resolved project and nothing
  else.
- **`done` is never set by `finish_task`.** Agents do not self-certify.
- **An agent never moves a task into `done`** (D-081, LAI-758). A caller
  authenticated by a personal access token — over REST or MCP — is refused
  any status whose **category** is `done`, however it names it (a category, a
  status id, a status name), from wherever the task is, including a move
  between two done statuses, a create with a done status and a status delete
  that would carry work into one. The refusal is `403 forbidden` with
  `details.reason: "agent_cannot_mark_done"` and a message pointing at
  `finish_task`. The agent table below has no edge into `done`: `review →
  done` was in it until LAI-758, and the agent rule read it (audit H6).
- **Moving to `done` asks the review rule** (M7): the assignee, a project
  `lead`, or org Admin/Owner — the same three as moving to `review`. A person
  accepts from the review queue (§11.4) or by moving the task on the board.
- **Claiming takes a task from where work starts** (M7): a `backlog` or `todo`
  status, or an unassigned `in_progress` one — released work, which moves no
  category. A done, cancelled or review task is refused `422`. The claim keeps
  the first `started_at` and records the status it came from.
- **A move between two statuses of the same category is not a transition**
  (§4.20, D-077). `In progress` → `Code review`, both `in_progress`, changes the
  column and nothing the table above reasons about: no readiness, no dates, no
  review rule. It needs `task.write` and nothing else, and it writes
  `task.status_changed` with equal `from` and `to`. A move **between**
  categories follows this section unchanged, whichever status it names — an
  agent cannot reach a `done` status by its id or name where §5 refuses it
  `done`.
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
  | `unavailable` | 503 |

  **`unavailable` is the shutting-down answer** (LAI-214). None of the others
  fits: nothing the caller sent is wrong, and the server is not broken — it has
  **decided to stop and has not stopped yet**. `503` with `Retry-After` is what a
  load balancer, a browser and an `EventSource` already understand, so a draining
  instance is drained from rather than retried against. **`GET /health` is exempt
  and answers normally**: a supervisor deciding whether to keep routing traffic
  here needs an answer, and *"I am draining"* is the most useful one it can get.

  **`payload_too_large` and `method_not_allowed` are distinct codes, not folded
  into `bad_request`** (D-021). Clients branch on `code`, not on status, and the
  remedies differ: a too-large body means send less, a wrong method means call
  differently, a malformed body means fix the JSON. Collapsing them would make
  three different problems indistinguishable to the caller. `bodyLimit` is on
  every route (§13.1), so 413 is routine behaviour rather than a corner case.

  **A finer reason travels in `details.reason`, never as a new code** (D-079):
  `session_required` when a token is refused only because §3.1 says *session
  only*; `local_activity_off`, `day_out_of_range` and `invalid_tz` on a local
  activity report (§6.4); `token_required` on a heartbeat (§9.1). The status
  and `code` stay the vocabulary above, so a client that branches on `code`
  keeps working, and one that needs the reason has it.
- **Idempotency**: `POST` accepts `Idempotency-Key`; replays within 24h return
  the original response. Same key with a different body is `conflict`.
  **One route keeps its own key** (LAI-746): `POST /users/:id/ratings`, which
  is session-only (§3.1). The shared store answers before the route runs, keyed
  by user rather than credential, and keeps the response body — which there is
  a private note — so that route stores the key on the rating and answers a
  retry from it after `can()`. Its keys are per rater and do not expire.
- **Rate limits**: in-process token bucket — 120 req/min per token, 600/min per
  session, 30/min for heartbeats, and for local-activity reports (`PUT
  /me/local-activity`, D-079) a bucket of **30, refilled one every 120
  seconds**: a burst of 30, then one every two minutes — up to 60 in a first
  hour, 30 an hour after — per token and per user for a session, on their own
  budget, snapshots and look-back reports alike (D-080). `429` with
  `Retry-After`, never below one second.

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
GET    /api/v1/me/activity-sharing           PUT .../activity-sharing  body { enabled?, scope? }   (PUT session only)
PUT    /api/v1/me/local-activity             a collector's report or look-back → { accepted_days }   (both switches on; 30/hour)
GET    /api/v1/me/local-activity             ?days=1–14 — what is held for the caller   DELETE → 204   (session only)
GET    /api/v1/org                           PATCH /api/v1/org       (admin+; ai_api_key write-only)
GET    /api/v1/users                         ?limit=&cursor=&updated_since=&include_inactive=
                                             cursor is (name, id) — a directory reads alphabetically
PATCH  /api/v1/users/:id                     (role, deactivate — admin+)
GET    /api/v1/users/:id/profile             PATCH .../profile  body { profile_kind }   (owner, admin; session only)
POST   /api/v1/users/:id/ratings             body { score, note } → 201   (owner, admin; session only; not yourself)
GET    /api/v1/people/:id/activity           ?range=12w|52w — the profile's heatmap by day   (owner, admin; session only)
GET    /api/v1/invites                       POST /api/v1/invites    POST /api/v1/invites/accept
GET    /api/v1/invites/:token                unauthenticated preview — org name, inviter, role, expiry
DELETE /api/v1/invites/:id                   revoke a pending invite (admin+)
GET    /api/v1/projects                      POST /api/v1/projects   (admin+)
       └ each entry adds five fields §4.3 does not store — see below
GET    /api/v1/projects/:slug                PATCH /api/v1/projects/:slug
POST   /api/v1/projects/:slug/join           (public projects)
GET    /api/v1/projects/:slug/members        POST/PATCH/DELETE .../members
GET    /api/v1/projects/:slug/context        PATCH .../context       (lead+)
GET    /api/v1/projects/:slug/tasks          ?status=&status_id=&assignee=&priority=&ready=&sprint=&tag=&parent=&updated_since=&cursor=
                                             status is a category (§4.5), status_id one project status (§4.20)
GET    /api/v1/projects/:slug/statuses       POST .../statuses  body { name, category, position? } → 201  (lead+)
PATCH  /api/v1/projects/:slug/statuses/:id   body { name?, hidden? } — category is refused   (lead+)
PUT    /api/v1/projects/:slug/statuses/order body { ids } — every status exactly once   (lead+)
DELETE /api/v1/projects/:slug/statuses/:id   body { move_to } — moves the work, then deletes   (lead+)
GET    /api/v1/projects/:slug/sprints        POST /api/v1/projects/:slug/sprints   (lead+)
       └ each entry adds `task_counts`, derived at read time — see below
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
POST   /api/v1/tasks/:id/finish              body { summary, checklist?, commits?, branch?, pull_request?, tests? }
                                             → review, with a round and its proof (finish_task's twin, D-081)
GET    /api/v1/tasks/:id/rounds              { rounds (newest first), send_back }
POST   /api/v1/tasks/:id/accept              → the first visible done status   (session only; the done rule, §5)
POST   /api/v1/tasks/:id/send-back           body { reason } → the first visible in-progress status   (session only)
GET    /api/v1/review                        the review queue — every review task the caller can act on
POST   /api/v1/tasks/:id/reorder             body { after_task_id?, before_task_id? } — manual order (D-070)
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
`{ title, description_md, acceptance_md, tags, priority, assignee_id,
parent_task_id, due_on, planned_start }`.
**`null` clears a field; absent leaves it alone** — they are different requests,
and `acceptance_md`, `assignee_id`, `parent_task_id` and both dates draw the
distinction. `tags` replaces the whole set. `POST /projects/:slug/tasks` takes
the same three optional fields (`parent_task_id`, `due_on`, `planned_start`)
beside `discovered_from`. `?parent=<id>` on the list returns that task's
subtasks only, and pages with `cursor` like any other filter (D-066).

**A project in `GET /projects` is §4.3's columns plus five derived at read
time** (LAI-053). None is stored, which is why §4.3 does not carry them and a
reader should not go looking:

| field | derived from |
| --- | --- |
| `task_counts` | tasks by §4.5 status. **Every status is present and zero is included** — a caller must not have to distinguish *"no tasks in review"* from *"the server did not say"* |
| `blocked_count` | tasks with at least one dependency that is not `done` (§4.6). **`blocked_by` only** — never what a task blocks |
| `member_count` | `project_memberships` |
| `members` | the **first five by name**, `user_id` and `name` only — enough for a row of avatars, and deliberately not a member list |
| `last_activity_at` | the newest `activity` row for the project; **nullable, and null means no activity rather than none visible to you** |

**A sprint in `GET /projects/:slug/sprints` is §4.15's columns plus
`task_counts`** (LAI-721), derived at read time in **one grouped query for the
project**, behind the same `project.read` check as the list: `{ total,
by_status }`, `by_status` keyed by every §4.5 status with **zero included** —
the projects list's rule, for the same reason. It is how the Timeline shows a
sprint's progress without loading its tasks (§11.4.3). **Only the list
carries it**: a sprint from `GET /sprints/:id` or returned from a write is the
plain §4.15 shape.

**A member's profile is one read** (D-078, LAI-743): `GET /users/:id/profile`
answers `{ user, window, projects, review, ratings, activity_sharing }`, and
for a `builder` also `current_work`, `delivery` and `agents` — **absent, not
empty**, for a `manager` — and for a `manager` also `queue`, absent for a
`builder` (LAI-750). `PATCH` takes exactly `{ profile_kind }` and answers the whole
profile, because the kind decides which blocks it carries. `POST …/ratings`
takes exactly `{ score, note }` — an integer 1–5 and a note of 1–500
characters after trimming — and answers the rating, `201`. With an
`Idempotency-Key` (at most 255 characters), a retry with the same key and body
answers the rating already written — `201`, `Idempotent-Replay: true`, no second
row — and the same key with a different body is `409`. All three ask §3.1's
`profile.*` **before** looking the person up: a member or any token gets `403`
for a real id and a made-up one alike, and only an owner or admin is told
`404`. Every figure is computed at read time in a twelve-week window starting
on a Monday, 00:00 UTC:

| field | what it counts |
| --- | --- |
| `projects` | a membership, a task assigned to them, or a review decision in the window; each with their role, open tasks, accepted and reviewed |
| `review` | their moves of a task that is not theirs — someone else's, or nobody's (LAI-751) — into a Done status (`accepted`) or from Review to an earlier status (`sent_back`), and the most recent of them, `assignee` null for an unassigned task; `per_week` (both, per week of the window), `last_30_days` (decisions in the thirty days to now) and `time_to_decide` — the median from the task's latest entry into Review to the decision (LAI-750). **The entry** is the latest move into a Review status from another category — a move between two Review statuses is not one — or, when every logged move before it stays inside Review, the task's creation, because it was created there (LAI-751). A decision made from outside Review, or one whose entry the log cannot place, is counted as `unmeasured` |
| `ratings` | §4.21, newest first; the first is the current one. At most 50, with `ratings_total` beside it (LAI-746) |
| `activity_sharing` | D-079's two switches for this person, `{ org_enabled, enabled }` — the organisation's Developer insights and their own sharing — whatever their kind, so the Activity card is drawn in its final shape before `GET /people/:id/activity` answers (LAI-751). Whether their pushed and local work may be shown, never a count of it |
| `current_work` | their tasks in progress, oldest start first, and in review, longest waiting first — each review task with `review_since`, its entry into Review by `review`'s rule, null when the log cannot say (LAI-751); each list at most 50, with `in_progress_total` and `in_review_total` |
| `delivery` | `accepted_per_week` and `accepted`: moves of their tasks into a Done status (D-077) by someone else; `sent_back`: Review to an earlier status by someone else; `reopened`: Done back into work; `cycle_time`: p50/p75 of `completed_at − started_at` for their tasks done in the window, the unstarted ones counted as `unmeasured` |
| `agents` | their usable tokens with the agent each last connected as (D-076), most recently used first, at most 50 with `tokens_total`; which agents are online now (§9.3) — never where; and `writes`: their `activity` rows made through a token in the window, grouped by the agent that token last connected as, most first, with `writes_total` — revoked tokens' writes included (LAI-750) |
| `queue` | a manager's only: projects they lead (membership role `lead`, not archived), the tasks in a Review status there that are not theirs — someone else's or nobody's (`waiting`, in total and per project) — and `oldest_waiting_since`, the entry into Review, by `review`'s rule, of the longest-waiting one (LAI-750, LAI-751) |

**This is not a §4 table and its rows are not columns** — the drift check reads
§4 only. Setting a kind or adding a rating writes no `activity` row, so neither
reaches SSE, an MCP tool or an export (§4.21).

**A member's activity heatmap is its own read** (D-079, LAI-751):
`GET /people/:id/activity?range=12w|52w` (default `12w`) answers

```json
{ "range": "52w", "start": "2025-10-17", "end": "2026-10-15", "tz": "Africa/Johannesburg",
  "sharing": { "org_enabled": true, "enabled": true },
  "series": { "github": [0, 3], "local_commits": [0, 0], "prompts": [0, 12],
              "sessions": [0, 1], "board_self": [1, 0], "board_agent": [0, 2] },
  "prompts_by_agent": { "2026-10-07": { "claude-code": 18, "codex": 5 } },
  "agents": ["claude-code", "codex"] }
```

- **Every series has one integer per day from `start` to `end`** — 84 days
  for `12w`, 364 for `52w`. `end` is today in `tz`: the zone of the person's
  most recent report while their local activity is shown, otherwise `UTC`.
- **`board_self` and `board_agent`** are §4.22's rollup — their own actions on
  a web session and their agents' with their tokens, by **UTC day**. Always
  there: they are what the board already records (D-078 item 4).
- **`github`, `local_commits`, `prompts` and `sessions` are `null`** — not
  zeros — **unless both switches are on for that person now** (§4.1, §4.2); then
  they sum every machine of theirs (§4.23), and `github` counts distinct pushed
  keys by the day first reported (§4.24). Local days are the reporting
  machine's own dates, aligned with the board's by date.
- `prompts_by_agent` holds only days with prompts and `agents` every agent in
  the range, most prompts first; `{}` and `[]` while local activity is not
  shown.
- Owners and admins on a web session only (§3.1), asked **before** the person
  is looked up, as for the profile. **Every read is a range of one person's
  days on an index that leads with the person** — no read touches `activity`,
  and a year is at most 366 rows per source.
- Context only: nothing in it feeds a rating or a score (D-079 item 6).

**The developer's side of D-079** (LAI-751), the contract the collector
(`laika activity`, LAI-752) is written against:

- `GET /me/activity-sharing` answers `{ org_enabled, enabled, scope,
  min_sync_interval_s }` — `600`, how often a collector may sync — to a
  session or any token of theirs, so a collector asks before it sends.
- `PUT /me/activity-sharing` takes `{ enabled?, scope? }` — `scope` is
  `agent-repos` or `laika-repos` — from a **web session only** and answers the
  same shape. Off stops collection at once and deletes nothing. No `activity`
  row: §4.8 has no verb for it.
- `PUT /me/local-activity` takes one machine's snapshot of its last days, at
  most **16 KB**:
  `{ "v": 1, "collector_id": "<uuid v4>", "tz": "<IANA zone>", "days": [{
  "day": "YYYY-MM-DD", "prompts": { "<agent kind>": n }, "sessions": n,
  "commits_local": n, "pushed_keys": ["<16 hex>"] }] }`. A day's fields but
  `day` may be omitted and count as none. Agent kind ids are 1–32 characters of
  lowercase `a–z`, `0–9` and `-` — the collector sends `claude-code`, `codex`,
  `gemini-cli`, `goose`, `kiro`, and `other` for Copilot CLI; one the board
  does not know is counted as `other`. Caps per day: each agent's prompts
  ≤ 5000, `sessions` ≤ 500, `commits_local` ≤ 2000; each pushed key exactly
  16 hex characters, and **no count of keys but the body's**: a key costs 19
  bytes in the list, so fewer than 900 fit in 16 KB however the days share
  them (LAI-751 review — a per-day cap of 2000 could never be reached, and was
  removed). It answers `200 { "accepted_days": n }` — **never the data** —
  and writes **no `activity` row**. Each (person, collector, day) is
  **replaced** by the report; pushed keys are added, a key already held keeping
  its earliest day, and never removed by a report.
- **A look-back report** (D-080, LAI-757) is the same `PUT` marked
  `"lookback": true`: `{ "v": 1, "collector_id", "tz", "lookback": true,
  "days": [{ "day": "YYYY-MM-DD", "pushed_keys": ["<16 hex>", …] }] }` — keys
  only, at least one per day; a day carrying `prompts`, `sessions` or
  `commits_local` is an unknown field. Each day once, within *today − 400* to
  *today + 1* in `tz` (§11.6's retention), the same **16 KB**, and the same
  bucket. It **writes no snapshot row** and replaces nothing: its keys join
  the set like a snapshot's, so sending it twice changes nothing. It answers
  `200 { "accepted_days": n }`.
- Refusals, in §6.3's envelope with the contract's reason in `details.reason`:
  `403 local_activity_off` when either switch is off (asked before the body is
  judged); `422 day_out_of_range` when `days` is empty, longer than 14, repeats
  a day, or holds a day that is not a date within *today − 14* to *today + 1*
  in `tz` — for a look-back, *today − 400* to *today + 1*, with that window's
  `earliest` and `latest` in `details`; `422 invalid_tz` for a zone the server
  does not know; `422` for any
  unknown field, wrong type or cap; `413` over 16 KB; `429` with `Retry-After`
  once the report bucket is spent — 30, refilled one every 120 seconds, per
  token (per user for a session; §6.3). A collector that
  is refused `local_activity_off` stops and asks again after 24 hours.
- **Which commits count** (settled with the collector, LAI-752; D-080):
  `commits_local` covers only commits the developer authored **after they
  turned sharing on**, and **merge commits are counted in neither** it nor the
  keys. A snapshot's `pushed_keys` follow the same start; **once per
  repository a look-back** adds keys for the developer's pushed commits of up
  to the last 365 days before it — only those no snapshot can count, so a
  commit counted local and pushed later is never also a look-back key. Their
  commits are the ones under their git identity (`user.email` and the extra
  emails they set), even ones an agent typed: git cannot tell. The collector
  enforces all of this before anything is sent; the server cannot see a
  commit, so it does not re-check it.
- **The collector** (`laika activity`, `cli/README.md`): `on`, `off`,
  `status`, `sync`, `emails`, and `backfill [--days N] [--yes] [<repo>…]` —
  which prints what the look-back found (commits, days, per month), asks
  before sending unless `--yes`, and sends it in look-back reports of at most
  16 KB, at most four a run, paced so that it and the snapshots never ask the
  collector's token for more than the bucket refills; what does not fit goes
  with the next syncs. Answered no, it records those repositories as declined
  and the automatic look-back skips them; a later `backfill` answered yes sends
  them. A background sync runs the look-back once for each repository it
  sees for the first time and has not been declined, after the snapshot and
  inside the same lock and 2-minute limit; a repository git cannot read stays
  due and is tried again after a backoff. **Sessions nobody is
  typing in count nothing**: the activity hook does nothing at all when
  `OMNIGENT=1`, `CI` or `LAIKA_ACTIVITY_SKIP` is set (D-080).
- `GET /me/local-activity?days=` (1–14, default 14) answers what is held for
  the caller over their last days — `{ start, end, tz, days: [{ day,
  prompts_by_agent, sessions, commits_local, pushed_commits }], collectors,
  oldest_day }`, newest first, only days with something held — **whatever the
  switches say**: what was kept before sharing was turned off is still theirs
  to see. `DELETE /me/local-activity` removes every local row and pushed key of
  theirs, `204`. Both **web session only**: an agent must not read back or
  erase what its person consented to.

**A task's read shape is §4.5's columns** — `branch` and `external_ref`
included, which `TaskView` omitted until LAI-493 (LAI-286) — and `TaskView`
adds the fields below, which are not stored there — **derived at read time, so a reader who looks for them in §4 will
not find them and should not**:

| field | where it comes from |
| --- | --- |
| `key` | `project.key` + `number` — the display key an agent works in (§7) |
| `tags` | `task_tags` (§4.16), the whole set |
| `comment_count` | `comments`, excluding soft-deleted |
| `created_by_client` | the token's name, when a token created it (LAI-093) |
| `status_name` | the `project_statuses.name` of `status_id` (§4.20) |
| `blocked_by`, `blocks` | **both directions of §4.6** — see §4.5. `ready` depends only on `blocked_by` |
| `send_back` | `{ reason_md, decided_by, created_at }` of the task's current send-back (§4.27), or `null` (D-081) |

`created_at` and `updated_at` are on every view and are not listed per endpoint.

**The review gate (D-081, LAI-758).** `POST /tasks/:id/finish` is
`finish_task`'s REST twin: the move to review, the summary comment and a new
round (§4.25) with its proof (§4.26), in one transaction. Every proof field is
optional, so a body with only `summary` and `checklist` behaves as before.
`commits` is `[{ sha, message? }]` — only the message's first line is kept —
`pull_request` an `http(s)` URL, and `tests` `[{ command, exit_code }]`; the
limits are §4.26's and a breach is `422` naming the field, with nothing moved.
`GET /tasks/:id/rounds` answers `{ rounds, send_back }`: each round as
`{ id, task_id, number, finished_by, client_name, summary_md, commits, branch,
pull_request, tests, created_at }`, each item with `id`, `state`,
`state_source` and `state_at` beside its own fields (`sha` and `message`,
`name`, `url`, `command` and `exit_code`), newest round first; `project.read`.

`GET /review` answers `{ tasks, truncated }`: every task in a `review`
status on every project where the caller holds `task.write`, **oldest waiting
first** — waiting since its latest move into review from another category —
at most 200, `truncated` saying when more wait. Each entry is `{ task,
project: { id, slug, name, prefix }, assignee_name, waiting_since, round,
finished_by_name, can_decide }`, `round` the latest (or `null`) and
`can_decide` whether this caller may accept or send it back. Not paginated:
it is the work waiting for a person.

`POST /tasks/:id/accept` moves a review task to the project's first visible
done status; `POST /tasks/:id/send-back` takes a required `reason` (1–5000
characters, trimmed) and moves it to the first visible in-progress status,
posting the reason as a comment by the person and recording it (§4.27). Both
answer the task, both are **web session only** — a token is refused `403`
with `details.reason: "session_required"` — and both ask §5's done rule. A
task not in review is `409` with `details.reason: "not_in_review"`. Neither is
a new activity verb: each writes `task.status_changed` with `via: "accept"` or
`via: "send_back"`, and a send-back's reason is that comment's
`comment.added`.

**A token never replays a session's answer it could not have had** (§6.3).
Idempotency keys are the person's, not the credential's (LAI-748), so a
stored answer to the same key and body is found by the same person's token.
For a review decision, and for any stored task in a done category, the route
runs instead and answers the token itself.

**Project statuses (§4.20)** are served as
`{ id, project_id, name, category, position, hidden, created_at, task_count }`,
`task_count` derived at read time. `GET …/statuses` answers `{ data }` by
position, unpaginated — a project has a handful. **Every write answers with the
whole list** as `{ data }`, because adding, deleting or reordering one status
moves others; `DELETE` adds `moved`, the number of tasks it moved. Reads need
`project.read`, writes `project.settings.edit`. Errors name statuses by their
names, never by enum values.

**`status` is not on `PATCH`.** It moves through `POST /tasks/:id/status`, which
takes **exactly one** of `{ status }` — a category, landing in the project's
first visible status of it — or `{ status_id }`, and writes
`task.status_changed` with `{ from, to }` (the categories) plus
`from_status_id`, `from_status_name`, `to_status_id` and `to_status_name`
(D-077). A category the task is already in is `409`, not a hop to another
column of it. `POST /projects/:slug/tasks` takes the same `status` or
`status_id`; both together must agree. The body is `strictObject`, so
a `PATCH` carrying `status` is refused `422` rather than quietly ignored — this
paragraph named it as writable on `PATCH` until 2026-09-02 (LAI-130), which is a
client built from the spec getting a `422` on its first status change.

---

## 7. MCP endpoint

Served by the same process at **`/mcp`** (Streamable HTTP transport). Auth is a
personal access token as `Bearer`, identical to §6.1.

**Any MCP client, not only Claude Code** (D-076). On `initialize` the server
returns `instructions`: the rules for working the board, written for any agent
(call `laika_whoami`, read `get_project_context`, claim with `start_working`
before coding, `create_task` when there is none, `add_comment` as you go,
`finish_task` into review with proof, a sent-back task's reason first,
`log_unlisted_work` for stray findings). Every
authenticated request stamps the token's `last_mcp_at`, and `initialize` records
the client's `clientInfo.name` and its slug on the token (§4.9). That is what
makes an agent with no heartbeat hook present (§9.3).

The instructions stay under 2,048 characters with the must-follow rules in the
first 512, and those rules are repeated in the descriptions of `start_working`,
`create_task` and `finish_task` for clients that never show `instructions`.
`/mcp` answers only `POST`: any other method gets `405` with `Allow: POST`. A
`401` says whether the `Authorization` header was missing, empty (`Bearer` and
nothing else) or an unexpanded placeholder, without echoing what was sent.

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
| `laika_whoami` | `{}` | the identity this token acts as — `user_id`, `name`, `email`, `org_role`, `token_scope` — and `how_to_work`, the same text as the server's `instructions`, for clients that drop those (D-076). Reads nothing, changes nothing |
| `list_projects` | `{}` | projects the user can read |
| `list_ready_tasks` | `{ project?, limit? }` | ready tasks exactly as §4.5 derives them — **unassigned** and unblocked — sorted p1→p3 then age |
| `get_task_context` | `{ task }` | **`send_back` first** — the reason a person sent it back, who and when, or `null` (D-081) — then task, description, `evidence` (the latest round's proof, or `null`) and `rounds` (how many), `blocked_by` + their statuses, comments (each with `sent_back`), recent activity, branch, `discovered_from` chain, `parent` (or `null`), `subtasks` with key, title, status and assignee, `subtasks_done` and `subtasks_total` (`total` excludes `cancelled`) |
| `get_project_context` | `{ project }` | `context_md`, its recent edit history, open-task summary, members + roles |
| `list_sprints` | `{ project }` | every sprint on the project, oldest first — id, name, dates, `status`, and task counts by status |
| `list_members` | `{ project }` | who is on the project — `user_id`, `name`, `email`, `role`. Where an assignee comes from |
| `create_task` | `{ project, title, description?, acceptance?, priority?, tags?, assignee?, sprint?, blocked_by?, discovered_from?, parent?, due_on?, planned_start? }` | created task, `created_via: 'mcp'`. `parent` is a task ref and makes this a subtask, one level only |
| `update_task` | `{ task, title?, description?, acceptance?, priority?, tags?, assignee?, sprint?, parent?, due_on?, planned_start? }` | task. Every field optional; an omitted one is left alone; `null` on `parent` or a date clears it. **No `status`** |
| `start_working` | `{ task, branch? }` | task, or `409` with the current assignee |
| `update_status` | `{ task, status, note? }` | task; validated transition. `status` is a category or a project status's name, case-insensitively (§4.20) |
| `set_task_sprint` | `{ task, sprint }` | task. `sprint: null` takes it out of whichever it is in |
| `add_comment` | `{ task, body }` | comment |
| `finish_task` | `{ task, summary, checklist?, commits?, branch?, pull_request?, tests? }` | task → **`review`**, summary posted as a comment, and a round with the proof, each item `claimed` (§4.25, D-081) |
| `create_sprint` | `{ project, name, goal?, start_date, end_date, status? }` | created sprint, with the id the other sprint tools take |
| `update_sprint` | `{ sprint, name?, goal?, start_date?, end_date?, status? }` | sprint. Completing one **does not move its tasks** (§4.15, D-013) |
| `update_project_context` | `{ project, context_md, mode }` | the document's new length. `mode` is `replace` or `append` |
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

**Seven tools added 2026-09-20 (LAI-611), taking the surface to eighteen.**
Sprints, post-creation task edits, assignment and the context document were
UI-only until then, so an agent could work the board but not manage it. A real
153-task import hit every one of those walls.

The vocabulary below is **the code's, not this section's earlier guesses** — each
was checked against the artefact rather than against the task that asked for it,
and each disagreed:

- **A sprint's field is `status`, not `state`, and its values are
  `planned | active | completed`.** There is no `closed` — `db/enums.ts` has the
  three, and so do the service, the REST body and §6.4.
- **Sprints are addressed by id, never by name.** `update_sprint` takes no
  project, so a name would have to be resolved across every readable project,
  and two projects may each have a "Sprint 3". `list_sprints` and `create_sprint`
  both return the id in their markdown as well as their payload.
- **Dates are `YYYY-MM-DD`**, with unix-ms still accepted for an agent holding
  one. §4.15 gives sprint dates date-only semantics, so the date is the honest
  input and the integer is the storage detail.
- **A task's prose fields are `description` and `acceptance`** on this surface,
  where the REST body spells them `description_md` and `acceptance_md`.
  `create_task` has taken `description` since LAI-408, and an agent that files a
  task and then edits it must not find the second call spells the field
  differently. One surface, one set of names.
- **`assignee` takes a user id or the email of a project member.** An id passes
  through untouched, so the write is identical to the REST one; an email is
  resolved against `list_members`, which needs only `project.read` where the org
  directory is behind `member_list.read`. Assigning work to somebody who is not
  on the project is not a thing this makes easy. **There is no `assign_task`** —
  a separate tool would be a second name for one service call.
- **`due_on` and `planned_start` are the only dates a tool writes** (D-066).
  `started_at` and `completed_at` are actuals and stay read-only on every
  surface. Both are unix-ms at a UTC midnight, as the REST body takes them.
- **`update_task` cannot change `status`.** Moving a task is `update_status`,
  because §5 validates transitions and a field edit would route around the
  table. An agent still finishes into `review` and never into `done`.
- **`update_status` speaks the project's own status names** (D-077). Its input
  is unchanged — a string called `status` — and a value that is not one of the
  six categories is looked up among the project's statuses by name,
  case-insensitively; one that matches nothing is `unprocessable`, and the
  error lists the names the project has. A category lands in the project's
  first visible status of it. Task lines and `get_task_context` show the
  category with the project's name beside it when the two differ —
  `review (Code review)` — so an agent keeps reasoning in categories and still
  sees the column a person sees.
- **`mode` on `update_project_context` is required**, deliberately: there is no
  safe default between adding a paragraph and discarding the document. `append`
  is a read-then-write and can lose a simultaneous addition — `context_md` is a
  single markdown field with no revision column.

### 7.2 Tool contract

- **Guardrail: tools never bulk-mutate.** One task per call.
- **`log_unlisted_work` is the one tool with no REST twin, deliberately** (D-024).
  Every other tool wraps a service a route also calls. Unlisted work is *by
  definition* something an agent noticed outside any project — a human at the
  board would file a task instead — so there is no human write path to mirror.
  Humans read it (`GET /api/v1/unlisted`) and act on it
  (`POST /api/v1/unlisted/:id/promote`). The parity tests of §13.3 therefore
  cover the seventeen tools that have twins; this one is exempt, and **the
  exemption is named**, so the missing pair reads as intended rather than as a
  gap. *(This
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
  No tool reaches `done`: `update_status` refuses any done status to an agent
  (§5, D-081), and accepting is a person's, in the web app.
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

**And a hook must not send a value it obtained from a failed command** (LAI-418).
`|| true` swallows the exit status; `$(…)` keeps the output — so a command that
**fails and still prints** hands the board a plausible wrong answer that nothing
can see. `git rev-parse --abbrev-ref HEAD` exits `128` on a repository with no
commit yet **and writes `HEAD` to stdout**, so the board would be told the branch
is called `HEAD`. Use `git branch --show-current`, which gives the real name on an
unborn branch and gives **nothing** on a detached `HEAD` — the case that should
be skipped.

**The mandatory fail-silent is what makes a plausible-but-wrong value
invisible.** The general form is worth more than the git case: **`failed` is not
always `empty`**, and `|| true` around anything that prints on failure has the
same hole.

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

- **Presence** (`GET /api/v1/presence`) — users with a heartbeat **or an `/mcp`
  call on a token** in the last 5 minutes (D-076). "Who is working right now."
  One entry per user, the newest session winning. Each entry carries `client`,
  the `AGENT_CLIENTS` slug of the newest live agent session or `null`, and
  `clients`, every distinct agent among that user's live sessions, newest
  first. `is_agent` is true for a heartbeat on a token or any live `/mcp` call.
  A token that is revoked or expired is not present, **whether it was last seen
  by `/mcp` or by heartbeat**, and does not count in Capacity. A signed-in
  session's heartbeat, which has no token, is unaffected.

  **An `/mcp` call carries no location.** Only a heartbeat supplies `repo`,
  `branch`, `project_ids` and `matched_task_id`, so a user seen only over MCP
  has `repo` and `branch` absent, `project_ids` empty and `matched_task_id`
  `null`, exactly as for a reader who may not be told where.

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
  question: whether presence is recorded at all. While it is off, no heartbeat
  is stored (LAI-150) and no token's `last_mcp_at` is stamped (D-076), so
  turning it back on shows nothing from the time it was off. The connecting
  client's name is still kept on the token, as token metadata.
- **Capacity** (`GET /api/v1/capacity`) — per user: `active_sessions` (distinct
  tokens seen by heartbeat or `/mcp` call in the window, one token doing both
  counted once; D-076),
  `in_progress_tasks[]`, `last_seen`, oldest in-progress age, tasks in review
  awaiting them, and `unlisted[]` from `log_unlisted_work`. Answers "who takes
  the next thing" and "what is stuck with nobody on it".

Both are computed from `heartbeats`, `tokens.last_mcp_at` and `tasks` at request
time. No separate presence store to fall out of sync. With `presence_enabled`
off, neither shows any session from either source.

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

**HMAC-SHA256 verified against the org's transcript secret, constant-time,
before the body is parsed** — the same shape as §10.1 and for the same reasons
(D-052). Unverified requests get `401`.

`/webhooks/*` is for machines: a transcript source is a recorder or a meeting
bot, never a session. **This is the one endpoint in Laika where a caller chooses
which data leaves the instance** — the prompt below carries the project's open
tasks and its whole `context_md`, and the caller picks the project — so it is
authenticated before anything is read, not after.

**A rate limit is not sufficient.** Each submission is a paid provider call, so
the org carries a **cap** as well as a rate, and reaching it answers distinctly
rather than as a generic `429`: an authenticated integration gone wrong spends
money at a perfectly legal rate.

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

**Kanban** (default). **One column per project status** (§4.20, D-077), in the
project's order — by default Backlog, To do, In progress, Review and Done, with
Cancelled hidden behind a filter rather than drawn. A lead adds, renames,
reorders, hides and deletes statuses; a deleted one's cards move to the status
the lead names. An empty status is still a column.

- Dragging a card between columns issues `POST /api/v1/tasks/:id/status` with
  the target's `status_id`. Between two statuses of the same category it always
  succeeds; between categories it is subject to the same transition validation
  as any other caller (§5) — an illegal drag snaps back and surfaces the error,
  it does not optimistically lie.
- Cards show: display key (`LAI-42`), title, assignee, **priority as Jira draws
  it** — a red up chevron for P1, an orange equals sign for P2, a blue down
  chevron for P3, each with its name for a screen reader (D-070) — a **blocked**
  marker when any dependency is unfinished, a **ready** marker when §4.5 holds,
  a **subtasks** `n/m` on a parent and `↳ KEY` on a child, and the **due
  date only when it is today or past** on open work — amber *Due today*, or
  red with a ⚠ once overdue; a date still ahead, and any date on finished
  work, draws nothing (D-069). Each is a card-field toggle.
- Cards **do not** show a stale marker, a comment count or an age (D-069).
  Staleness is still flagged by the server (§11.6) and listed in Activity;
  comments are counted in the drawer's tabs; the List keeps its Updated column.
- Agent-authored recent activity is badged on the card (`actor_kind: 'agent'`).
- The `ready` marker is **derived** — never stored, never cached client-side
  beyond the current response.
- **Card order within a lane is stored, and it is the reader's** (D-060,
  D-070): each lane draws its cards in the project's `position` order (§4.5),
  not by priority. Dragging a card between two others puts it there — in its
  own lane, or in another lane at the place it was dropped, which also changes
  its status — and Alt with an arrow key does the same from the keyboard. The
  card moves on drop and returns if the server refuses. A new task lands at the
  bottom of its lane. A reader who may not write tasks cannot drag one.
- **Live changes apply in place** (D-071): a stream frame, Refresh or drawer
  edit merges into the board on screen and never swaps it for a skeleton. A
  card that changes place glides there in 200ms; one someone else changed
  glows for 3.6s, on the card or the List row. Under reduced motion it lands at
  once and the glow is a still ring. A failed refresh keeps the board with an
  "as of" notice, unless the reader has lost access.

**List.** The same tasks as a sortable, densely readable table: key, title,
status, assignee, priority, dependency count, due, updated — the title's
sub-line names the parent (`↳ KEY`) and the blockers. Sortable on every column,
multi-filter on status / assignee / priority / ready / blocked. This is the view
for triage and for boards too large to drag. It opens **newest-updated first**,
and its sort is URL state like the filters (D-065). Created and updated read
`just now` / `N min ago` / `N h ago` for a day, then a date and time, with the
full timestamp on hover.

Rows **select** (D-067): a checkbox on every row and one in the header for the
page, with *Select all* over every row the filter left. Once anything is
selected a bar offers status, priority, assignee, sprint and cancel for the
whole selection, sent as **one request per task** — there is no bulk endpoint
and §7.2 keeps it that way — and reports what was refused, by key, with the
server's reason. The status cell is itself a menu of the legal targets (§5),
issuing the same `POST /api/v1/tasks/:id/status` as a drag. A viewer gets none
of it.

Both views:

- share one filter state, reflected in the URL so a filtered board is linkable;
- update live over SSE (§11.5) rather than polling;
- paginate through the same cursor API (§6.3) — the kanban board loads per
  column, and a column with more results says so rather than silently truncating.

**Explicitly not in v1:** swimlanes, WIP limits, saved views. Columns are the
project's own statuses (§4.20) since D-077; the six categories under them stay
fixed. When columns are not enough, use the list, which is where many tasks
become one gesture (D-067).

#### 11.4.2 UI screens → API coverage

**D-059 changed the shape this table describes, and the table has not caught up.**
The **endpoint column is still correct** — every row names what that surface
cannot function without, and `endpoint-coverage.test.ts` (LAI-460) checks the
served side against what the client calls. **The *nav* model is not**: there is no
WORK / REVIEW sidebar, screens are not all routes, and several of these rows are now
**tabs inside a space**.

**Read the rows as surfaces, not as destinations**, until this section is
rewritten against the refreshed design:

**No exact widths here** (D-063). This table says what a screen must contain;
a pixel figure in it duplicates a CSS value nothing can check it against, and
both rows that carried one had drifted before anyone noticed. Each row names
the decision currently governing it rather than the table naming one for all.

| | | decision |
| --- | --- | --- |
| the sidebar | **ORG** — *Capacity*, *Review* with its waiting count for everyone signed in (D-081), and *Unlisted work* with its open count for owners and admins — then **SPACES** — two recent spaces, *More spaces* — then SETTINGS. A space is a project with a two-letter key, a count and a colour | D-059.1, amended by **D-061**; ORG by **LAI-754** (the owner, 2026-10-15) |
| Task detail | a **centred modal over a dimmed board**, dismissed by the scrim or Escape — not a screen, and not a right-hand drawer | D-059.2, amended by **D-063** |
| Timeline, Calendar, Dashboard, Meeting review | **tabs across the top of a space** | **D-059.3** |
| Capacity, Review, Unlisted work | **one page each, across every space the reader can see**, reached from the sidebar's ORG group — `/capacity`, `/review` and `/unlisted`, no space bar and no tabs. A `/capacity?project=` link from when Capacity was a tab is rewritten to `/capacity` | **LAI-754** — *"Capacity must not be at project level; it must go to the sidebar and be global"* |

Checked against `docs/design/Laika Prototype.dc.html` — **which is dated 24 August
and is behind the owner's live design.** `docs/design/README.md` says which copy
is canonical.

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
| **Board** | 2 | `GET/POST /projects/:slug/tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/claim`, `POST /tasks/:id/status`, `GET /projects/:slug/members`, `GET /events`, `GET /watching` | `create_task`, `start_working`, `update_status`, `finish_task` | ✅ |
| **Task detail** *(slide-over on Board, not a nav item)* | 2 | `GET/PATCH /tasks/:id`, `GET /tasks/:id/rounds`, `GET/POST /tasks/:id/comments`, `PATCH/DELETE /comments/:id`, `POST/DELETE /tasks/:id/dependencies`, `GET /projects/:slug/activity`, `PUT/DELETE /tasks/:id/watch`, `GET /tasks/:id/watchers`, `GET /projects/:slug/mentionable` | `add_comment`, `get_task_context` | ✅ |
| **Sprints** | 2 | `GET/POST /projects/:slug/sprints`, `GET/PATCH/DELETE /sprints/:id`, `POST /sprints/:id/tasks`, `DELETE /sprints/:id/tasks/:taskId`, `GET /projects/:slug/tasks?sprint=` | — | ✅ D-013 |
| **Timeline** | 2.5 | `GET /projects/:slug/timeline`, `GET/PATCH /sprints/:id` | — | ✅ D-014 |
| **Tokens** | 3 | `GET/POST/DELETE /tokens`, `GET /users/:id/tokens`, `DELETE /users/:id/tokens/:tokenId` | — | ✅ |
| **Organisation** | 1 basic / 6 LLM | `GET/PATCH /org`, `GET /users`, `PATCH /users/:id`, `GET/POST /invites` | — | ✅ |
| **Connect** *(not in the prototype)* | 7 | `GET/POST /tokens`, `GET /presence`, `GET /org`, `GET/PUT /me/activity-sharing`, `GET/DELETE /me/local-activity` | — | ✅ D-079 |
| **Capacity** *(sidebar, global)* | 5 | `GET /capacity`, `GET /presence`, `GET /projects`, `GET /tasks/:id`, `GET /unlisted` (the open count, owners and admins) | — | ✅ LAI-754 |
| **Review** *(sidebar, global)* | 5 | `GET /review`, `GET /tasks/:id/rounds`, `POST /tasks/:id/accept`, `POST /tasks/:id/send-back` | `finish_task` | ✅ D-081 |
| **Unlisted work** *(sidebar, global; owners and admins)* | 3 | `GET /unlisted`, `POST /unlisted/:id/promote`, `DELETE /unlisted/:id`, `GET /users` | `log_unlisted_work` | ✅ LAI-754 |
| **Member profile** *(owners and admins; not in the prototype)* | 7 | `GET/PATCH /users/:id/profile`, `POST /users/:id/ratings`, `GET /people/:id/activity` | — | ✅ D-078, D-079 |
| **Dashboard** | 5 | `GET /projects/:slug/metrics`, `GET /projects/:slug/tasks`, `GET /projects/:slug/activity`, `GET /projects/:slug/members`, `GET /projects/:slug/mentionable`, `GET /projects` | all, indirectly via `activity` | ✅ |
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
  with counts; cards showing key, title, assignee, priority, **blocked / ready
  markers**, subtasks and a due date that is today or past; drag between columns issuing a real status call with snap-back
  on rejection; filters by assignee/priority/ready; live update over SSE;
  agent-authored badge; empty column states.
- **Task detail** — laid out as a Jira issue view (D-066): a header with the
  breadcrumb `↳ PARENT-KEY / KEY` (the parent key opens the parent) and plain
  icon actions — watch with the watcher count, share, `⋯`, close; the left
  column holding the title, a collapsible description, acceptance when set,
  **Subtasks** (progress `n/m done`, one row per child that opens it, detach,
  inline add), **Linked tasks** with **BLOCKED BY** / **BLOCKS** relations and
  their statuses, and **Activity** with All / Comments / History / Changes
  tabs and the composer at the top; the right rail holding the status control,
  a **Details** card — assignee, priority, parent, due date, labels, sprint,
  start date, reporter (`created_by`), `created_via` provenance, watchers,
  `discovered-from` — a **Development** card (branch, external ref, commits)
  when any of them is set, and `Created` / `Updated` at the foot. Comments
  distinguish human from agent.
  **A Proof section beside Acceptance** once the task has been finished
  (D-081): the send-back it carries first, then the latest round — round
  number, the agent that finished it, commits (short sha and first line),
  branch, pull request as a link only when `http(s)`, test commands with their
  exit codes in green for `0` and red otherwise, and a `claimed` badge on every
  item — with earlier rounds folded. A comment that is a send-back's reason is
  marked *sent back*, and a card carrying a send-back wears a *sent back*
  marker with the reason as its tooltip.
  **A watch toggle and who else is watching** (D-047, D-054), and an
  **`@` autocomplete in the comment box fed by `GET /projects/:slug/mentionable`
  — never by the member list**, because who may be mentioned is the server's
  answer and not a filter the client reapplies.
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
  list with role controls; danger zone gated to Owner; a **Developer insights**
  switch for owners and admins (§4.2, D-079) with a plain sentence of what it
  allows — every developer still decides for themselves — read-only for
  everyone else.
- **Connect** — the four-step wizard, and under *Optional* a **Share local
  activity** item for the signed-in developer (D-079): what is sent and what is
  never sent, on/off, the scope (every repo where they use an agent, or only
  repos set up for Laika), the `laika activity on` command, a preview of what
  the server holds for them over the last 14 days, and *Delete my
  local-activity history* with a confirmation. With the organisation's switch
  off it says so and offers nothing to turn on.
- **Capacity** (`/capacity`, one page across every space, LAI-754) — who is
  active now with repo, branch and resolved task; agent sessions distinct from
  humans; in-progress work across projects as chips of **key and title** (the
  whole title on hover), at most three a person and then *+N more*; last seen;
  a summary strip saying how many spaces it reads across and, for owners and
  admins, a link to *Unlisted work* with the open count; disabled state when
  `presence_enabled = 0`. **No unlisted notes on this screen** — they are on
  their own page.
- **Review** (`/review`, everyone signed in, D-081) — the queue of tasks in a
  review status on every project the reader can act on, **oldest waiting
  first**: key, title, project, assignee, the agent that finished it, time
  waiting, the proof in brief (commits, PR, tests passed and failed, or *no
  proof*) and the round. A summary card of tiles — waiting, oldest, failing
  tests, no proof — with an (i). Filters: project, assignee, *Failing tests*,
  *No proof*. A row opens the full proof (the task panel's Proof section) with
  **Accept** and **Send back…**, the second asking for a required reason in a
  dialog; both are disabled, saying why, for a reader who may not decide.
  *Open on board* opens the task. The waiting count is in the header and beside
  the sidebar entry. There is no organisation-wide stream, so the page re-reads
  every 20 seconds, when the tab returns and after each decision.
- **Unlisted work** (`/unlisted`, owners and admins, LAI-754) — **one line per
  note**: repo, who, when and the note's first line, newest first; a click opens
  the full text with **Promote to task** and **Dismiss** under it; the first
  page of lines and then *Show more*; a *Show dismissed* toggle; the open count
  in the header and beside the sidebar entry.
- **Dashboard** — shaped like Jira's project Summary (D-072): **done, updated,
  created and due soon** for the chosen range; a **status donut** with the share
  done at its centre; a **donut of open work by person**, Unassigned as its own
  share, each person opening the board filtered to them; activity feed with an
  **agent/human filter**; **needs attention** (blocked and stale, true counts);
  priority breakdown; throughput and cycle time; updates in place on a live
  change; read-only for Viewer.
- **Meeting review** — the proposals, tagged **NEW / CHANGED / DEAD /
  DECISION**, each shown **with the transcript quote it was reacting to**;
  per-line accept and reject; apply acts only on accepted items; discard the set.
  **There is no transcript pane, because there is no transcript** (D-056): §4.12
  keeps a `transcript_hash` and never the words. The quotes are what makes a
  proposal reviewable, and they are all that is kept.
- **Member profile** (`/people?user=<id>`, D-078) — owners and admins only:
  anyone else sees a permission notice and the profile is never requested.
  Laid out as cards on a grid that folds to one column on a phone (LAI-750).
  A head card with name, org role, project count, email, member since, an
  *owners and admins only* pill and the **Builder / Manager** control, which
  says it is a label and not a permission; **projects** as horizontal bars —
  a builder's open tasks, a manager's review decisions — with role and
  figures; for a builder, **delivered** — accepted per week as twelve bars,
  sent back, reopened, cycle p50/p75 with the unmeasured count — **current
  work**, **agents used** — one bar split by share of writes, each agent with
  its mark, share and tokens — and **online now**; **review work** with
  decisions in 30 days, median time to decide and review load per week, and
  for a manager the queue — projects led, waiting now, oldest waiting — and
  **recent decisions**; the **rating** — the latest on top, the history
  below, *Rate* for anyone but yourself, a dialog taking 1–5 and a required
  note. What each figure counts is in an (i) beside it, not in paragraphs.
  Every figure from the response; an empty state, never a zero, where there is
  nothing. **Current work** shows at most five rows of the chosen list —
  *In progress* or *In review*, longest waiting first — with *Show all* opening
  the rest inside the card in a bounded scroll; no card stretches its row
  (LAI-751). **Agents used** is one row per agent, the token names behind an
  expand (LAI-751).
  An **Activity** card (D-079, LAI-751) heads the page: a daily heatmap from
  `GET /people/:id/activity`, **12 weeks or 1 year** (a phone opens on 12
  weeks; the year scrolls sideways inside the card with the weekday column
  pinned), in two designs each viewer chooses between and the browser
  remembers — **A**, one grid with each day split GitHub / Local, and **B**,
  one grid per source on a shared week axis (the default). GitHub is violet,
  Local amber, Board slate; a legend per source; a tooltip with the day's whole
  breakdown — pushed commits, local commits, prompts per agent, sessions, board
  actions by them and by their agents; arrow keys move between days and each
  day reads as text; stats — active days, current and longest streak, busiest
  weekday, pushed vs local — computed on the client. It says plainly when the
  organisation's switch is off (with a link to Organisation), when the person
  has not turned on sharing, and when nothing has arrived yet. Context only:
  nothing on it feeds the rating. Reached from a person's name on Organisation, a Capacity card or a
  *Work by person* row — links for owners and admins, plain text for everyone
  else.

#### 11.4.3 Timeline view

A Gantt-style view of the project's schedule, drawn **entirely from sprint
boundaries** (§4.15) and shaped like Jira's timeline (D-074).

- **One row per sprint**, in date order. The row's left column names it (`S3`
  and its name, the goal on hover), its dates, a countdown and its state —
  *Ended*, *Active*, *Planned* — taken from the **dates**, not the stored
  status. Its bar spans `starts_on` to `ends_on`.
- **Each bar shows done over total** without being opened, from the sprint
  list's `task_counts` (§6.4); `cancelled` counts in neither.
- **The axis scrolls sideways at a zoom** — Weeks, Months or Quarters, kept in
  `?zoom=` — with a fixed width per day. The sprint column and the header stay
  put; the chart, unscheduled tasks included, is the screen's one vertical
  scroller and one tab stop, and the arrow keys pan it. The window is whole
  months (quarters, at Quarters) around every sprint and today, and the header
  is drawn only for the stretch in view.
- **Today** is one line down the rows, with a pill in the header naming the UTC
  day the line is drawn on, and a *Today* button scrolls back to it.
- **A sprint opens to list its tasks** — key, title, status, assignee, and
  *Blocked* or *Blocked?* (a blocker in another sprint, not loaded) — loaded
  with `?sprint=<id>` when it is opened, at most three sprints at a time.
  **Tasks have no bars of their own.** An opened sprint's bar adds its blocked
  count, with blockers outside it counted as *unknown*. A task opens in the
  drawer.
- `?sprint=<id>` opens that sprint and starts the chart at it; the Board's
  `all` and `none` are not sprints and open nothing.
- Sprints entirely in the past are dimmed, not hidden. A sprint whose dates are
  not dates, or are more than fifty years from today, is listed in a notice
  (each in its own words) and not drawn; anything nearer is drawn, however far.
- Tasks with `sprint_id IS NULL` are the chart's **last group, Unscheduled**,
  loaded with `?sprint=none` when it is opened. Read-only here: moving a task
  into a sprint is the Sprints screen's `POST /api/v1/sprints/:id/tasks`.
- Live: a frame on the space's stream refetches the sprints and every open
  sprint, so an edit lands without a reload.
- **Not built yet** (still required by §11.4.2.1): dragging a sprint edge to
  reschedule (`PATCH /api/v1/sprints/:id`, rejected on overlap) — LAI-731 —
  and dragging an unscheduled task into a sprint.

**The constraint that keeps this cheap:** the timeline is a *sprint* chart, not a
*task* chart. Tasks now carry `planned_start` and `due_on` (§4.5, D-066), and
**this screen does not read them**: a task-dated timeline is a
dependency-aware Gantt with a layout engine, a critical path and a scheduling
model, which D-014 priced and D-066 accepted — as its own task (LAI-289), not
as a side effect of the columns existing.

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
- **local-activity retention** — delete `local_activity_days` rows and
  `pushed_commit_keys` dated before the day 400 days ago (D-079), daily **and
  once at boot**, because every deploy restarts the server (D-073) and a daily
  interval may not come round. It writes no `activity` row: §4.8 has no verb
  for it, as it has none for the snapshot or the vacuum
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
| `LAIKA_SECRET` | **required — no default** | encryption key material (§12). **Minimum 32 characters**; a shorter value is a startup failure, not a warning, and the value is redacted from the error. **Back it up separately from the database and not beside it** — §12's columns are unreadable without it, and a backup containing both loses everything when one file is lost. `docs/OPERATIONS.md` has the restore drill |
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

**Local activity counts are inbound, opt-in twice, and counts only** (D-079).
A developer's own machine sends per-day counts to their own board — only while
the organisation's *Developer insights* and their own *Share local activity*
are both on — and nothing leaves the deployment. Never prompt text, file
names, repository names or paths, remote URLs, branch names, commit messages,
author emails or raw commit ids. No call to GitHub is added.

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
   **The payload is now defined and served** (LAI-124): daily throughput buckets,
   and cycle time as `p50`/`p75`/`p90` over completed tasks that had a
   `started_at`, with the unmeasured ones counted separately rather than assumed.
   **The open question is narrower than it was, and it is the one that matters:**
   are these the right two numbers? **Nothing on the Dashboard renders them yet**
   — LAI-457 — so the question has not been tested against a real board.
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

10. ~~**Is there a Calendar screen?**~~ **Answered by D-059: yes, as a tab
    inside a space**, shipping with **visible demo data** in the D-032 shape — one
    demo module, naming the endpoint that retires it, saying so on the screen, and
    a test that no demo string reaches the bundle.

    **It does imply per-task dates**, so it reopens D-014 exactly as this question
    warned: the endpoint it waits for is **`tasks.due_date`**. Until that exists
    the screen is demo-fed and says so. **The warning was right; the owner
    accepted the cost rather than the question being wrong.** The column now
    exists as **`tasks.due_on`** (D-066, LAI-493); wiring the Calendar to it and
    retiring its demo module is its own task.
11. **Password reset and magic-link sign-in.** The login mockup shows "Forgot?"
    and "Email me a sign-in link". Neither exists in §6.1 or §6.4, and both need
    working SMTP. Either specify them (endpoints, token lifetimes, SMTP as a hard
    dependency) or cut them from the design. Currently listed as artifacts in
    `docs/design/README.md` and **not** to be built.

*(Questions about a Timeline date model and the sprints non-goal were resolved on
2026-08-24 — see D-013 and D-014.)*
