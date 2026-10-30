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

**Changed 2026-10-17 (D-085).** *Story points* and *time tracking* stay out in
the sense they were meant: no points field anybody is asked to fill in, no
velocity in points, no timesheet. What exists instead is a **forecast Laika
computes** from what it already holds — a size `XS`–`XL` relative to the
project's typical task, a build-time range once the project has history, and
the actual beside it — with an optional override by anyone who may edit the
task (§4.32, §6.4). It is never a score of people: accuracy is reported per
project, and per agent client only where at least three people use it (D-078
item 6). Phase 2 (LAI-772) adds a build-token range beside the hours, the
claimant's own optional estimate at claim (§4.34), and a sprint forecast —
*"85% likely to finish 18–23 of 26"* — computed from the project's throughput
and those sizes. None of it is a number anybody is asked to type.

**Changed 2026-10-20 (D-088).** *Time tracking* is off this list for
**confirmed time only**: Laika drafts each person's day on their own machine
from signals it already holds, the person confirms it, and confirmed entries
go to Solidtime, which stays the billing record. A manager closes the month.
Per-person hours are visible to owners and admins only, every view logged and
shown to the person; members see project totals. It is never a measure of a
person's performance, and agent time is shown as agent minutes, never hours.
Screenshots, keystrokes, idle tracking and prompt text stay out.

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

- **Owner** — the person who installed Laika. Exactly one, transferable. The
  only one who changes roles and decides what each role may do (D-102).
- **Admin** — creates projects, invites members and viewers, manages webhooks
  and org settings. Cannot delete the org, transfer ownership, change roles or
  change what each role may do.
- **Member** — the working role. Creates and edits tasks, comments, claims work,
  mints their own tokens. **This is what agent sessions run as.**
- **Viewer** — read-only. Tokens are forced to `read_only` scope.

**The owner decides who sees what** (D-102 rule 6, LAI-958). A small, fixed
set of capabilities is granted per org role — admin, member, viewer — on
Organisation → Roles & permissions (`PUT /org/permissions`, §6.4), stored per
org × role (§4.58). Each carries existing §3.1 actions and nothing new. The
owner holds every one, always, and is not a column that can change. **The
matrices below are the defaults** — admin on, member and viewer off — which is
what an organisation whose owner changed nothing has; `can()` reads the
organisation's grants for exactly these actions and no others.

| Capability | Carries |
| --- | --- |
| *See everyone's analytics* | `profile.read`, `profile.activity.read`, `usage.read_people` (and LAI-957's `people.analytics.read`) |
| *See the organisation's activity history* | `audit_log.export` |
| *Open every project* | the implicit project role above: `lead` on every project, `viewer` for an org viewer, who stays capped |
| *Invite people* | `user.invite` (as member or viewer only) |
| *Deactivate people and reset access* | `user.deactivate`, `user.sign_out` (somebody else; anyone signs themselves out — LAI-981), `user.reset_password` (not for the owner — LAI-983) |
| *Create and archive spaces* | `project.create`, `project.archive` |
| *Manage anyone's tokens* | `token.list_any`, `token.revoke_any` |
| *Change organisation settings, Time and breaks* | `org.settings.edit`, `org.time.set`, `org.developer_insights.set` |

*Invite people* and *Deactivate people and reset access* were one
capability, *Manage people and invites*, until D-104 item 6 (LAI-985); an
organisation that had stored a choice for it holds that choice for both. Each
capability carries a one-line `description` from the server (§6.4's
`GET /org/permissions`), so a screen explains a switch without inventing the
words.

**Never grantable, owner only:** delete the organisation, transfer ownership
(`org.delete`, `org.transfer_ownership`), change org roles (`user.set_role`)
and change what each role may do (`org.permissions.manage`). A grant widens
the role and nothing else: *session only* and `read_only` tokens narrow it
afterwards exactly as they narrow a role (§3.3 rule 4). Per-person exceptions
are not part of this.

### 3.1 Org-level permission matrix

| Action | Owner | Admin | Member | Viewer |
| --- | :---: | :---: | :---: | :---: |
| Delete org data | ✓ | — | — | — |
| Transfer ownership | ✓ (session only) | — | — | — |
| Org settings (AI provider, SMTP, signup mode) | ✓ | ✓ | — | — |
| Create / archive project | ✓ | ✓ | — | — |
| Invite users | ✓ | ✓ (as member or viewer) | — | — |
| Change org roles | ✓ | — | — | — |
| Set what each role may do | ✓ (session only) | — | — | — |
| Deactivate user | ✓ | ✓ | — | — |
| Sign a person out everywhere | ✓ | ✓ | ✓ (themselves) | ✓ (themselves) |
| Issue a password-reset link | ✓ (session only) | ✓ (session only, not for the owner) | — | — |
| View member list | ✓ | ✓ | ✓ | ✓ |
| Join a `public` project | ✓ | ✓ | ✓ (as member) | ✓ (as viewer) |
| Generate, read and revoke own tokens | ✓ | ✓ | ✓ | ✓ (`read_only` forced) |
| List / revoke **anyone's** token | ✓ | ✓ | — | — |
| Read own agents | ✓ | ✓ | ✓ | ✓ |
| Register and manage own agents | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
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
| Configure webhooks | ✓ (session only) | ✓ (session only) | — | — |
| View the organisation | ✓ | ✓ | ✓ | ✓ |
| Presence and capacity | ✓ | ✓ | ✓ | ✓ |
| View a member's profile | ✓ (session only) | ✓ (session only) | — | — |
| Set a member's profile kind | ✓ (session only) | ✓ (session only) | — | — |
| Rate a member | ✓ (session only, not themselves) | ✓ (session only, not themselves) | — | — |
| View a member's activity heatmap | ✓ (session only) | ✓ (session only) | — | — |
| View a member's day, time and shared activity | ✓ (session only, not themselves) | ✓ (session only, not themselves) | — | — |
| Turn Developer insights on or off | ✓ (session only) | ✓ (session only) | — | — |
| Read own activity-sharing setting | ✓ | ✓ | ✓ | ✓ |
| Set own local-activity scope | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Send own local activity | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
| Read and delete own local activity | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| View the organisation's token usage | ✓ | ✓ | — | — |
| View anyone's token usage, per person | ✓ (session only) | ✓ (session only) | — | — |
| View own token usage | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Set API-equivalent prices | ✓ (session only) | ✓ (session only) | — | — |
| Read and dismiss own token alerts | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Read and set own plan limit | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Set the organisation's Time setting | ✓ (session only) | ✓ (session only) | — | — |
| Read own time settings | ✓ | ✓ | ✓ | ✓ |
| Set own Draft my time | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Send own time drafts | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
| Read and manage own time drafts | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Read and write own time entries | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Sync own time with Solidtime | ✓ (session only) | ✓ (session only) | ✓ (session only) | ✓ (session only) |
| Map Solidtime projects and people | ✓ (session only) | ✓ (session only) | — | — |
| Import everyone's Solidtime time | ✓ (session only) | ✓ (session only) | — | — |

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
  not the matrix: it is the organisation's `developer_insights` (§4.2, its
  own row above), which the service reads on every report. Since D-102
  (amended, LAI-963) the developer's `share_local_activity` (§4.1) stops
  nothing.
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

**The token-usage rows are D-084's** (LAI-769): `usage.read_org`,
`usage.read_people` and `usage.read_own`, with §3.2's `usage.read_project`,
behind §6.4's `GET /usage` and `GET /users/:id/usage`. They follow D-084 item
7 — owners and admins see everyone, a developer their own, a member a
project's totals and **never a per-person split**.

- **The organisation's figure** — totals, days, agents, models, top tasks —
  is its own row, not *Export audit log* borrowed: the two answer alike today
  and mean different things. It names no person, so it is a read a token may
  make, `read_only` included.
- **Anything per person is the profile's rule**: `usage.read_people` and
  `usage.read_own` are session only, so **no token reads a per-person figure,
  not even its own person's**. `GET /usage` answers a reader without
  `usage.read_people` with `by_developer: null` rather than refusing the page.
- **Sending tokens is not a new row.** A usage report is the collector's, on
  `PUT /me/local-activity` under *Send own local activity* and the
  organisation's switch (D-084 item 4; D-102 amended). So is OpenTelemetry (LAI-773): Claude Code's
  metrics on `POST /otlp/v1/metrics` are the developer's own usage sent
  another way, under the same row and the same switch.

**LAI-773's rows** — `org.model_prices.set`, `token_alerts.own` and
`plan_limit.own`, with §3.2's `budget.set` — are all **session only**:

- **Prices and budgets are the figures that exist to watch agents.** An
  agent's token that could lower a model's price, or raise its own task's
  budget, would silence the very alert meant for its person. Who may set the
  organisation's AI provider may set what its models cost — its own row, not
  *Org settings* borrowed, because a token may hold that one.
- **A person's alerts and plan limit are their own** (D-087). Every role holds
  the rows; the services read the caller's own rows only, and no row lets
  anybody read another's. The plan limit has no admin row at all.

**The time rows are D-088's** (LAI-787): `org.time.set`,
`time_settings.read_own`, `time_settings.set_own`, `time_drafts.send_own`,
`time_drafts.read_own` with `time_drafts.manage_own`, and
`time_entries.read_own` with `time_entries.write_own`, behind §6.4's
`PUT /org/time`, `/me/time-settings`, `/me/time-drafts`, `/me/time` and
`/me/time-entries`.

- **Both switches are a web session's**, as D-079's are: the organisation's
  *Time* (`off`, `manual`, `drafts`; §4.45) is its own row and not *Org
  settings* borrowed, because a token may hold that one and an agent must not
  turn on the drafting of its own person's day; the person's *Draft my time*
  (§4.46) is theirs alone.
- **Sending is a collector's and an agent's.** A collector uploads its blocks
  and an agent proposes an entry (§7.1's `propose_time_entry`) under *Send
  own time drafts*, with any `full` token of the person's; the services read
  both switches on every send. The Viewer's cell is the credential's refusal.
- **Drafts and per-person hours are the person's, signed in** (D-088 items 3,
  7 and 13). No token reads or confirms a draft — not even the person's own —
  and there is **no admin row** for drafts at all. Confirmed time per person is
  never served to a token either, the rule *View own token usage* follows; who
  else may see a person's hours is LAI-789's, behind rows of its own.

**The Solidtime rows are D-088 item 10's** (LAI-788): `time_sync.own`,
`time_sync.map` and `time_sync.import_all`, behind §6.4's
`/me/time/solidtime` and `/org/time/solidtime`. All three are **session
only**.

- **The CLI signs in for them.** Pushing a person's confirmed time to
  Solidtime means reading it, and the rule above serves it to no token — so
  `laika time push` and `pull` ask for the person's password, sign in, and
  keep no session after the run. An agent holding the person's token can
  neither read the hours nor write them anywhere.
- **Every role syncs their own**, the time-entry rows' reason; the services
  touch the caller's own entries only.
- **Saying which Solidtime member is which person, and pulling everyone, are
  an owner's or admin's** (D-088 item 7): the CLI suggests a match by email
  on its own machine, and only the confirmation reaches the board.

**"View a member's day, time and shared activity" is `people.analytics.read`**
(D-102 rules 1–4, LAI-957), behind §6.4's `GET /people/:id/time`, `GET
/people/:id/time/summary` and `GET /people/:id/local-activity`. It is *See everyone's analytics* (§3's grants),
with the profile, the heatmap and the per-person tokens: the cells above are
the defaults. **It amends the time rows' *"no admin row for drafts"*** — an
owner, and whoever the owner grants it, reads a person's My day, drafts
included, and their held local activity, **in the shape the person reads
them**: the same answers as `GET /me/time` and `GET /me/local-activity`,
from the same code. Read only — no row lets anybody write another person's
time, drafts, breaks or switches, and every `/me` write touches the
caller's own rows. Reading follows no sharing switch, and collection
follows only the organisation's Developer insights (D-102, amended).

- **"not themselves"**: a person's own is `/me`'s, where nothing is logged.
- **Every read of somebody else is logged** (§4.59) — this row's two reads
  and the heatmap's and per-person tokens' — in the read's own transaction,
  so a read that cannot be logged is not answered. The person reads who
  looked on `GET /me/analytics-views` under *Read and delete own local
  activity* (`local_activity.read_own`): what is held about them and who has
  seen it are the same Developer access screen's, every role's, session only.

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
| Create tasks | ✓ | ✓ (unless space admins only) | — |
| Edit / move any task | ✓ | ✓ | — |
| Claim a task (`start_working`) | ✓ | ✓ | — |
| Save a checkpoint on a task your agent holds | ✓ | ✓ | — |
| Re-tag a checkpoint one of your agents saved | ✓ | ✓ | — |
| Offer a task your agent holds to another agent | ✓ | ✓ | — |
| Approve a cross-owner hand-off | ✓ | task's assignee | — |
| Accept a hand-off or recovery offer | ✓ | ✓ | — |
| Decline a hand-off or recovery offer | ✓ | ✓ | — |
| Cancel a hand-off offer | ✓ | own agent's or task's assignee | — |
| Edit the project's hand-off policy | ✓ | — | — |
| Assign a task to someone else | ✓ | ✓ | — |
| Add comment | ✓ | ✓ | — |
| Edit / delete comment | own + any | own | — |
| Cancel / delete task | ✓ | own-created | — |
| Add / remove dependencies | ✓ | ✓ | — |
| Read tasks, comments, activity, capacity | ✓ | ✓ | ✓ |
| Watch / unwatch a task | ✓ | ✓ | ✓ |
| Apply a meeting-diff proposal | ✓ | ✓ | — |
| Read a project's token totals | ✓ | ✓ | ✓ |
| Set token budgets | ✓ (session only) | — | — |
| Leave a project | ✓ | ✓ | ✓ |

**Per-space rules (D-103, LAI-976).** *Create tasks* follows the space's
`task_create_min_role` (§4.3): `member`, the default, is the cell as written;
`lead` takes it from members, so only space admins (and org Owners and Admins,
as implicit leads) create tasks there. A viewer never does. It holds on every
path that makes a task — REST, MCP, a meeting review and a promoted unlisted
note — because all of them create through one service that asks `can()`.
**When a space's `agents_allowed` is off,
agent tokens may read and nothing else there**: every other row is refused to
a token in that space, as a `read_only` token's would be, and people on a web
session are unaffected. A refusal by either rule is `403 forbidden` with
`details.reason` `task_create_min_role` or `agents_off`. *Leave a project*
refuses the last lead `409 conflict` with `details.reason: last_lead` — hand
over first.

**Checkpoints and hand-offs** (§4.70 – §4.74, D-114 – D-116, LAI-544). The
eight rows are `task.checkpoint.create`, `task.checkpoint.retag`,
`task.handoff.offer`, `task.handoff.approve`, `task.handoff.accept`, `task.handoff.decline`,
`task.handoff.cancel` and `project.handoff_policy.edit`, in that order. Each
is asked of the **owner's** role; the agent's grant and token then narrow it
as every row is narrowed (§4.64, §6.2), and the project's hand-off policy
narrows the four `task.handoff.*` actions that delegate or transfer —
**never** a read or a comment (D-114 item 3). *Save*, *Offer*, *Accept* and
*Decline* are a **registered agent's** acts: a session or a legacy token is
`403`, `reason: not_an_agent`; saving and offering also need the task's live
claim (§6.3's fence), and accepting or declining needs the offer to be
addressed to the calling agent, or to any eligible agent. *Re-tag* is also an
agent's: any registered agent **of the saving agent's owner** with a `full`
grant, so a replacement agent can re-verify a dead one's save; it needs no
claim, because it changes no task, only which ref is the checkpoint's newest. **Approve is a
person's, signed in** (session only): the task's assignee, or a lead (an org
Owner or Admin is an implicit lead), and **never the owner of the receiving
agent** — `403`, `reason: approver_is_receiver` — so nobody approves a
transfer to themselves. *Cancel*'s *own agent's or task's assignee* is an
offer sent by a session of the caller's own agent, or any offer on a task
assigned to the caller (§4.73: the sender, the task's assignee or a lead
cancels); a lead cancels any. Reading checkpoints and offers follows *Read
tasks*.

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
| `system.estimate.refit` | §11.6: the nightly refit of sizes and forecasts (D-085) |
| `system.time.prune` | §11.6: time retention — drafts after 30 days, entries after three years (D-088) |
| `system.claim.expire` | §11.6: a claim whose lease lapsed becomes `expired` (§4.66, §9.1, LAI-541) |
| `system.handoff.recover` | §11.6: a claim that expired with a `verified` checkpoint gets a **recovery offer** (§4.73) — offered, never assigned (LAI-546) |
| `system.handoff.expire` | §11.6: a live offer past `expires_at` becomes `expired` and a paused claim resumes (§4.73, LAI-546) |
| `system.checkpoint.verify` | §10.1: a signed push delivery for a `laika-ckpt/` tag records its transition and re-derives the ref's state (§4.71, §4.72, D-116, LAI-545) |
| `system.checkpoint.prune` | §11.6: checkpoint retention, 90 days after the task reaches `done` or `cancelled` (§4.70, D-115 item 9, LAI-545) |

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
| `share_local_activity` | integer | default **0** — was the developer's own half of D-079's two switches. **Read by nothing since D-102 (amended, LAI-963)**: collection follows the organisation's `developer_insights` alone (§4.2), and no endpoint writes it. Kept, not dropped, so what each person last chose is not lost |
| `local_activity_scope` | text | `agent-repos` \| `laika-repos`, default `agent-repos` — which repositories their collector counts in: every one where they run a connected agent on that machine, or only those set up for Laika. The server cannot see a repository; it stores the choice and the collector honours it (D-079) |
| `last_seen_at` | integer | nullable — the latest activity of a session of theirs that has since been ended (deactivation or a forced sign-out), kept because ending a session deletes its row. The API's `last_seen_at` is the later of this and their live sessions' `updated_at` (D-104 item 3, LAI-981) |
| `created_at`, `updated_at` | integer | |

**Deactivation ends access** (D-104 item 3, LAI-981). Deactivating a person
revokes every token of theirs and deletes every session, in the same
transaction as `is_active = 0`; reactivating restores neither — they sign in
again and mint new tokens. *Sign a person out everywhere* (§3.1,
`POST /users/:id/sign-out`) deletes the sessions alone and leaves tokens.

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
| `developer_insights` | integer, default **0** — the switch that alone decides local-activity collection since D-102 (amended, LAI-963; was the organisation's half of D-079's two switches), set from a web session by the owner or a role granted *Change organisation settings, Time and breaks* (*Turn Developer insights on or off*, §3.1). Off: no developer's local activity is accepted and the heatmap shows board actions only. On: every connected machine's is. Readable by everyone, for `presence_enabled`'s reason. |
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
| `context_md` | text — the shared project brief served to agents (§7.1). Always the newest §4.68 revision's `body` |
| `context_revision` | integer, default 0 — the current revision of `context_md` (§4.68, LAI-555): `0` for a document never written, then one more on every write. A write names the revision it replaces (§7.3) |
| `board_hide_done_days` | nullable integer — finished work older than this many days leaves the board; null never (LAI-266) |
| `color` | nullable — one of the design's palette, `black` \| `violet` \| `teal` \| `blue` \| `amber` \| `magenta` \| `red` \| `green`; null until one is picked (D-103) |
| `task_create_min_role` | `member` (default) \| `lead` — who may create tasks (§3.2, D-103) |
| `agents_allowed` | boolean, default true — off, agent tokens only read here (§3.2, D-103) |
| `former_prefixes` | JSON array of every prefix the project carried before `prefix`. A task stores its `number`, not its key, so a new prefix re-keys every task; a key resolves against `prefix` first and these second, so every old key keeps naming its task. Unique across the org together with `prefix`, enforced in code (D-103) |
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
| `external_ref` | nullable — an **outside id**, the id this card has somewhere else: a repo task file's `LAI-123`, a Jira or GitHub key — a prefix of 1–16 letters, digits and `_` starting with a letter, a dash, and 1–9 digits, stored upper-case and **taken wherever a task key is** (§7, LAI-780); **one task's within its project** — a write of one another task there holds is refused `422` `taken` naming it, checked by the service because pull requests' refs share the column; across projects allowed — or the pull request the GitHub webhook last recorded, `owner/repo#N`, which never writes over an outside id |
| `stale_flagged_at` | nullable, set by cron (§11.6) |
| `position` | nullable — **manual board order**, one sequence per project; a lane draws its tasks in this order (D-060, D-070). An opaque key compared byte-wise: set on create at the **end** of the project's order, moved only by `POST /tasks/:id/reorder`, which writes this one row. Nullable only so the column could be added to a populated table — the boot backfill fills every null in the order the board already showed (priority, then number), so a served task always has one |
| `started_at`, `completed_at` | nullable — **served on `TaskView`** (LAI-126). `started_at` is stamped the **first** time a task enters `in_progress`, by any route in — a claim after the task was released included (LAI-743) — and a later re-entry does not move it: a task sent back for rework did not start twice, and overwriting would silently shorten every cycle time derived from it (§11.6). |
| `estimate_id` | nullable FK `task_estimates` (§4.32) — the model's estimate in force; null only until Laika has computed one (D-085) |
| `estimate_at_start_id` | nullable FK `task_estimates` — the model's estimate in force when work **first** started, set when `started_at` is and never moved again (D-085 item 5). Every estimate-versus-actual reads this copy |
| `size_override_id` | nullable FK `task_estimates` — the `person` row in force; null when nobody has set a size |
| `estimate_hash` | nullable — a hash of everything the model read for the current estimate (title, description, acceptance, tags, what blocks it, its children and the project's model version), so a recompute that would change nothing costs nothing |
| `selected_agent_id` | nullable FK `agents` (§4.63), `ON DELETE SET NULL` — the registered agent **meant to do the work** (D-114 item 7, LAI-535). Not the assignee and not a claim: selecting one opens a **work request** addressed to it, and changes neither `assignee_id`, `status` nor anything a claim holds; a task can stay human-only. Set by `PATCH /tasks/:id` and `update_task` (§6.4, §7.1) by anyone who may edit the task, to **their own** agent only — active, granted `full` on the project, in a space whose agents may write (the hand-off policy's defaults, proposal §4.5; other members' agents wait for LAI-546). `null` withdraws the request. Served on `TaskView` as `selected_agent` |
| `handoff_count` | integer, default `0` — **completed** hand-offs of the task: an accepted `handoff` or `recovery` offer adds one in the accept's transaction (§4.73); a work request does not. Compared with the project policy's `max_handoffs` (§4.74). Never decremented (LAI-546) |

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
gave for sending the task back from review (D-082).

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
| `agent_id` | nullable FK `agents` (§4.63), `restrict` — *which* registered agent wrote the row (D-114 item 4, LAI-535), read by the activity writer from the token's `agent_id` and from nothing else. Null for a session, a legacy token, the system and **every row written before the column existed: never back-filled** |
| `agent_session_id` | nullable, no FK — the agent session (§4.65) the row was written under (D-118, LAI-586): the session a claim was just taken or finished under, else the one holding the writing agent's live claim on the task, else null. Read by the activity writer from the database, never from a request; only ever the writing agent's own session |
| `session_harness` | nullable — that session's self-reported `harness` **when the row was written** (D-118) |
| `session_harness_version` | nullable — likewise its `harness_version` |
| `session_model` | nullable — likewise its `model`. The three are a **snapshot**: a later heartbeat that changes the session's model does not change what this row says ran. All four are null for a row not written by an agent session and **every row written before the columns existed: never back-filled** |
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
`user.deactivated`, `user.reactivated`, `user.signed_out`,
`org.ownership_transferred`, `task.stale_flagged`,
`heartbeat.pruned`, `invite.expired`, `meeting_review.expired`,
`meeting_review.discarded`, `task.agent_selected`, `task.claim_expired`,
`task.claim_reclaimed`, `task.checkpoint_saved`, `task.handoff_offered`,
`task.handoff_approved`, `task.handoff_accepted`, `task.handoff_declined`,
`task.handoff_cancelled`, `task.handoff_expired`, `task.recovered`.

**`task.agent_selected`** (D-114 item 7, LAI-535) is a task's selected agent
set, changed or cleared — one verb for every direction, payload `{ from, to }`,
as `task.assigned` is for the assignee. Its own verb rather than `task.updated`
because *"when was this asked of that agent, and by whom"* is the question
§4.8's test asks. The proposal's working name was `agent_selected`.

**`task.claim_expired`** (proposal §4.2, §4.4, LAI-541) is an agent session's
claim on the task losing its lease: the expiry scan (§11.6) — or a heartbeat
that arrived after the lease lapsed — marked it `expired` (§4.66). Written by
the **system** (§3.4), because nobody did it; payload `{ generation,
session_id, agent_id, lease_expires_at }`. Its own verb because *"when did the
work on this stop being held, and whose was it"* is the question, and its
generation is invalid for good from that row on. Three owners (CLAUDE.md §4.4):
this row (LAI-540), the enum and CHECK (LAI-541), and the client mirror and its
wording (LAI-543).

**`task.claim_reclaimed`** (proposal §4.2, LAI-541) is the agent whose claim
expired taking the task back explicitly, at the next generation; payload `{
from_generation, generation, session_id, agent_id }`. Its own verb rather than a
quiet new claim: *"who took it back, after what gap"* is the question. Three
owners as above: this row (LAI-540), the enum (LAI-541), the client mirror
(LAI-543).

**The eight hand-off verbs** (proposal §4.4, D-115, D-116, LAI-544). Each is
three-owner (CLAUDE.md §4.4): this row (**LAI-544**), the enum and CHECK, and
the client mirror and its wording (**LAI-549**; LAI-550 shows them in the
Inbox). Dotted like every verb here; the proposal's working names drop the
`task.` prefix, and its `task_recovered` is `task.recovered`. Each is its own
verb because *"who handed this over, to whom, and when"* is the question, and
a reader filtering on `type` should not open a payload to learn it.

- `task.checkpoint_saved` — enum **LAI-545**, mirror **LAI-549**. Written when a checkpoint is registered (§4.70) — once per checkpoint; a repeated key writes nothing. **Verification writes no row**: the state is on the checkpoint. Actor: the saving agent. Payload `{ checkpoint_id, commit_sha, branch, claim_generation, session_id }`.
- `task.handoff_offered` — enum **LAI-546**, mirror **LAI-549**. Written when a hand-off offer is made, `open` or `pending_approval` (§4.73). Actor: the sending agent. Payload `{ offer_id, kind, to_agent_id, checkpoint_id, commit_sha, requires_approval, expires_at, from_generation }`.
- `task.handoff_approved` — enum **LAI-546**, mirror **LAI-549**. Written when a person approves a cross-owner offer, or names and approves the receiver of an unnamed recovery. Actor: that person. Payload `{ offer_id, to_agent_id, named }`.
- `task.handoff_accepted` — enum **LAI-546**, mirror **LAI-549**. Written when a receiver accepts — the claim moves. Actor: the receiving agent. Payload `{ offer_id, kind, checkpoint_id, receiver_commit_sha, from_generation, from_claim_state, generation, claim_id, session_id, agent_id, handoff_count }` — `from_claim_state` `transferred` for a hand-off, `expired` for a recovery or a lapsed sender. The selection change it makes writes its own `task.agent_selected`.
- `task.handoff_declined` — enum **LAI-546**, mirror **LAI-549**. Written when the receiver declines. Actor: the receiving agent. Payload `{ offer_id, reason }`.
- `task.handoff_cancelled` — enum **LAI-546**, mirror **LAI-549**. Written when a live offer is closed by anyone but its receiver or the clock — `closed_reason` `withdrawn`, `reclaimed`, `task_closed` or `agent_revoked` (§4.73). Actor: whoever closed it; the system for `task_closed` and `agent_revoked`. Payload `{ offer_id, closed_reason }`.
- `task.handoff_expired` — enum **LAI-546**, mirror **LAI-549**. Written when §11.6's scan expires a live offer. Actor: the **system** (§3.4). Payload `{ offer_id, expires_at }`.
- `task.recovered` — enum **LAI-546**, mirror **LAI-549**. Written when the system opens a **recovery** offer for a task whose claim expired with a verified checkpoint (§3.4 `system.handoff.recover`) — by **any** expiry path: the scan, a late heartbeat, or a live hand-off closing unaccepted after its sender's claim lapsed (§11.6) — not when it is accepted, which is `task.handoff_accepted`. Actor: the **system**. Payload `{ offer_id, checkpoint_id, commit_sha, from_generation }`.

A work request's opening and withdrawal stay `task.agent_selected` (LAI-535),
and its acceptance by the selected agent's claim writes no hand-off verb: no
claim moved between sessions.

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
| `last_rest_write_at` | nullable (D-081). The last REST request on this token that writes — any method but `GET`, `HEAD` and `OPTIONS`, under `/api/` — stamped at most once a minute like `last_mcp_at`, and **not while `presence_enabled` is off**. Presence only (§9.3); a read never moves it |
| `agent_id` | nullable FK `agents` (§4.63), cascade (D-114, LAI-534). Set, the token is that registered agent's credential and its access is narrowed by the agent's grants (§4.64); null is a **legacy** token, which works exactly as before and carries no agent. **Cascade, never set null**: null is the wider value, so losing an agent row must remove its tokens rather than turn them into their owner's own. Indexed. The agent comes from this column and nothing else — no header, parameter or body field can name one |

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
- **A legacy token's name is visible to anyone who can read the task.** It is
  not private metadata. Do not put anything in it you would not show a project
  member. **A registered agent's token is different (D-120):** its name is served
  to the agent's owner only and is `null` for every other reader, who sees the
  agent as `harness · device` instead (§6.4 `created_by_client`). The one
  exception is access oversight: org owners and admins reading a person's
  profile (`profile.read`) see that person's token names, registered agents
  included (§6.4 profile `agents`).
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

**Heartbeats are not the only source of presence** (D-076, D-081). A token's
`last_mcp_at` or `last_rest_write_at` (§4.9) also makes its user present, for
the agents that send no heartbeat. Nothing about that path is stored here.

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
`tasks(parent_task_id)`, `tasks(status_id)`, `tasks(estimate_id)`,
`tasks(estimate_at_start_id)`, `tasks(size_override_id)`, `task_estimates(task_id, created_at)`,
`tasks(external_ref, project_id) WHERE external_ref IS NOT NULL` — a card found by
its outside id, and the outside prefixes the sharing answer serves (LAI-780),
`project_statuses(project_id, position)` unique, `member_ratings(user_id, created_at)`,
`board_activity_days(user_id, day)` unique, `local_activity_days(user_id, day, collector_id)`
unique, `local_activity_days(day)`, `pushed_commit_keys(user_id, key)` unique,
`pushed_commit_keys(user_id, day)`, `pushed_commit_keys(day)`. The heatmap's reads
are each a range of one person's days on an index that leads with the person;
retention deletes by `day` alone (§11.6).
`token_usage_days(user_id, day, collector_id)`, `token_usage_days(day, agent,
model, user_id, task_id, input, output, cache_write, cache_read)`,
`token_usage_days(project_id, day, …)` the same columns `WHERE project_id IS NOT
NULL`, and `token_usage_days(task_id, day) WHERE task_id IS NOT NULL` — the
Usage page's reads are each one range of one index that carries every column
they sum (§4.33) — and `token_usage_days(day, model, input, output,
cache_write, cache_read) WHERE collector_id = 'telemetry'`, what telemetry
added over a range (LAI-773).
LAI-773's: `token_budgets(task_id)`, `token_budgets(sprint_id)` and
`token_budgets(project_id) WHERE scope = 'project'`, each unique;
`token_alerts(subject_id, period, threshold, limit_tokens) WHERE kind =
'budget'` unique — a budget alert is raised once — `token_alerts(subject_id,
created_at)`, `token_alerts(project_id, created_at)` and
`token_alerts(user_id, created_at) WHERE user_id IS NOT NULL`;
`token_session_days(user_id, day, source, collector_id, session_key, model)`
primary, `token_session_days(day)` and `token_session_days(user_id,
session_key)` — the match reads a session's every day (§4.38);
`token_telemetry_series(user_id, series_key)` primary;
`token_session_skips(user_id, session_key)` primary; `token_arrivals(user_id,
bucket_ms)` primary and `token_arrivals(bucket_ms)`;
`token_usage_zones(user_id)` primary.
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
| `commits_local` | integer — their commits that day on no remote yet; merge commits and commits authored before their machine was connected are not counted (§6.4) |
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
(§6.4, D-079, LAI-751). Commits authored after their machine was connected (`laika activity on`), and once
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
it did (D-082, LAI-758). **A task has as many rounds as it was finished**:
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

One item of a round's proof (D-082): a commit, the branch, the pull request or
a test run. **Each item carries its own `state`**, so step 2 (D-083, LAI-766,
GitHub confirming the proof) changes `state`, `state_source` and `state_at` on
a row and needed no change to this table.

| field | notes |
| --- | --- |
| `id` | ULID |
| `round_id` | FK `task_rounds`, cascade |
| `kind` | `commit` \| `branch` \| `pull_request` \| `test_run` |
| `position` | the order the agent sent the items in, from 0 |
| `value` | the sha (7–40 lowercase hex), the branch name, the pull request URL (`http:` or `https:` only) or the test command |
| `detail` | nullable — a commit's first line; null for every other kind |
| `exit_code` | nullable — a test run's exit code, required for one and null for every other kind (CHECK) |
| `state` | `claimed` \| `confirmed` \| `failed`, default `claimed` — what the agent said, until something other than the agent checks it. GitHub's deliveries decide the other two (§4.28–§4.31, D-083): a commit, branch or pull request item only ever goes from `claimed` to `confirmed`; a test item follows CI both ways, and goes back to `claimed` while a re-run is pending |
| `state_source` | nullable — what changed `state`: `github`. Null while `claimed` |
| `state_at` | nullable — when `state` last changed. Null while `claimed` |
| `created_at` | |

Indexed on `(round_id, position)` for the panel and on `(kind, value)` for
step 2, which knows a sha or a pull request, not a round: a delivery's sha is
looked up as every prefix of it from 7 characters, so the index serves a
claimed abbreviation too. A round holds at most
50 commits and 50 test runs; a commit's first line is at most 200 characters, a
branch 200, a URL 500 and a command 500 (§6.4).

### 4.27 `task_reviews`

What a person did with a task waiting in review: **accepted** it or **sent it
back** with a reason (D-082, LAI-758).

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

### 4.28 `github_commits`

A commit a GitHub delivery said exists (D-083, LAI-766): every commit a `push`
lists and its `after`, and the head of every `pull_request`. What a round's
commit items are matched against — **including commits pushed before the agent
finished**. Recorded whether or not a project tracks the repository.

| field | notes |
| --- | --- |
| `repo` | `owner/name`, lowercased |
| `sha` | the full 40-hex sha, lowercase |
| `branch` | nullable — the **first** branch it was seen on; a fast-forward to the default branch names the same commit again and does not replace it |
| `committed_at` | nullable — the commit's own timestamp from the push; null for a pull request's head |
| `seen_at` | the last delivery that named it |

Primary key (`repo`, `sha`); indexed on `sha` (a prefix is a range on it) and
on `seen_at`. **Kept 30 days from `seen_at`**, pruned by the deliveries
themselves.

### 4.29 `github_pull_requests`

A pull request as its newest `pull_request` delivery described it (D-083).

| field | notes |
| --- | --- |
| `key` | `host/owner/name#number`, lowercased — what a pull request URL reduces to, so an agent's URL matches GitHub's `html_url` whatever its case or a trailing `/files` |
| `repo` | `owner/name`, lowercased |
| `number` | integer |
| `url` | GitHub's `html_url` |
| `head_sha` | nullable — the head commit |
| `head_ref` | nullable — the head branch |
| `merged` | integer, default 0 — 1 once GitHub reports it merged |
| `event_at` | the pull request's `updated_at`; a delivery older than the row changes nothing |
| `seen_at` | |

Indexed on `head_sha` and `seen_at`. Kept 30 days from `seen_at`.

### 4.30 `github_checks`

One CI result for one commit, as its newest delivery reported it (D-083): a
`check_run`, a `workflow_run` or a `check_suite`. Keyed by name, so a re-run
replaces the run it repeats — **newest event wins**.

| field | notes |
| --- | --- |
| `repo` | `owner/name`, lowercased |
| `head_sha` | the commit, full and lowercase |
| `kind` | `check_run` \| `workflow_run` \| `check_suite` |
| `name` | the job's name, the workflow's name, or the app's slug for a suite |
| `outcome` | `pending` \| `passed` \| `failed` — `passed` for `success`, `neutral` and `skipped`; `failed` for `failure`, `timed_out`, `cancelled`, `action_required` and `startup_failure`; `pending` for anything not completed, and for `stale` |
| `conclusion` | nullable — GitHub's own word; null while pending |
| `event_at` | the run's own `completed_at`, `updated_at` or `started_at`; an older delivery changes nothing |
| `seen_at` | |

Primary key (`repo`, `head_sha`, `kind`, `name`); indexed on `head_sha` and
`seen_at`. Kept 30 days from `seen_at`.

### 4.31 `task_round_github`

What GitHub said about one round (D-083): whether its pull request was merged
and the CI line for its head commit. Written whenever the round is checked and
**kept with the round**, so the proof reads the same after the 30-day records
it came from are gone.

| field | notes |
| --- | --- |
| `round_id` | FK `task_rounds`, cascade; the primary key |
| `pr_merged` | nullable — 1 merged, 0 not, null when no delivery named the pull request |
| `ci_head_sha` | nullable — the commit CI was read for |
| `ci_total` | integer, default 0 — the CI results counted |
| `ci_passed` | integer, default 0 |
| `ci_failed` | integer, default 0 |
| `ci_pending` | integer, default 0 |
| `ci_failed_names` | a JSON array of the names that failed, at most ten, default `[]` |
| `updated_at` | |

**How a round is checked** — on every finish, and for every **open** round a
delivery could change: the newest round of its task, finished in the last 30
days, with no `task_reviews` row against it (§4.27). An earlier round, or one a
person has accepted or sent back, keeps what GitHub said while it was the one
waiting, and no later delivery rewrites it.

- **Plausible repositories.** The project's `repo` (§4.3) when it names one,
  and only that: a pull request in another repository confirms nothing and
  nothing is matched through it, so the agent never chooses who vouches for
  it. Only when the project names no repository does the pull request's own
  narrow it — and then nowhere else. With neither, any repository this org's
  webhook reports.
- **commit** → `confirmed` when exactly one seen commit in a plausible
  repository has the claimed sha as its full sha or prefix (at least 7). Two
  commits sharing the prefix is ambiguous and confirms neither.
- **branch** → `confirmed` when a push to it or a pull request from it was seen.
- **pull request** → `confirmed` when a delivery for it was seen; `pr_merged`
  says whether it was merged.
- **test runs** → from CI for the round's **head commit**: the pull request's
  head when GitHub named one, else the newest claimed commit GitHub reported
  (latest commit time; on a tie the first listed), else the first listed. CI
  counts one kind — the check runs if any were reported, else the workflow
  runs, else the check suites — because one GitHub Actions run reports itself
  as all three. Any failed → every test item `failed`; all passed →
  `confirmed`; otherwise `claimed`. A typed command cannot be matched to a CI
  job, so every test item takes CI's answer and the CI line says what it was.
  **No CI result is not a result**: with nothing reported for the head commit,
  the test items and the CI line are left as they were.

### 4.32 `task_estimates`

A task's size and build-time forecast, as history (D-085, LAI-771).
**Append-only**, as `member_ratings` is: a recompute or a person's override
adds a row and never edits one, and three triggers refuse `UPDATE`, `DELETE`
and an `INSERT OR REPLACE` over an existing id — re-established at every boot.
`tasks` points at the rows in force (§4.5), so what is shown changes by moving
a pointer and the history is never rewritten.

| field | notes |
| --- | --- |
| `id` | ULID |
| `task_id` | FK `tasks`, `ON DELETE RESTRICT` — a history row keeps its subject, as `activity`'s do (LAI-135); tasks are cancelled, never deleted |
| `source` | `model` \| `person` |
| `level` | `XS` \| `S` \| `M` \| `L` \| `XL` — relative to the project's typical task, weights 0.25 / 0.5 / 1 / 2 / 4. Null only on a `person` row that clears an override (CHECK) |
| `weight` | nullable real — the computed weight, 1 being the project's typical task; on `model` rows |
| `build_p50_ms`, `build_p80_ms` | nullable — the build-time forecast, likely and pessimistic. Null in a cold start |
| `tokens_p50`, `tokens_p80` | nullable — the build-token forecast, likely and pessimistic: input, output and cache writes up to the first finish (LAI-772). Null until the project has 10 finished tasks with attributed token data |
| `subtasks` | integer, default 0 — children rolled into it |
| `inputs_hash` | nullable — what the model read, hashed: `tasks.estimate_hash` when the row was written |
| `model_version` | nullable — the project's fitted model it came from |
| `factors_json` | the *why* as it was when computed — each factor's contribution in levels, the similar finished tasks it used, the method and the typical task. Default `{}` |
| `set_by` | nullable FK `users` — the person, on a `person` row, and only there (CHECK) |
| `created_at` | |

**What the model reads** — the task's own signals and nothing about who holds
it: the words of its description and acceptance (the strongest signal on
Laika's own history, rank correlation 0.45), its criteria, what it is blocked
by, its tags, and the 7 most similar finished tasks in the same project by
TF-IDF over title, description and acceptance. A ridge regression in log
space, shrunk towards 0.9 per log word, blended with the similar tasks' median
— additive, so the *why* lists each factor's exact contribution and they add up
to the weight. Priority is read and given nothing, and the *why* says so.
Computed inside Laika; nothing leaves it.

**When it is computed.** Inline, in the write that changed an input — create,
an edit of the title, description, acceptance or tags, a dependency added or
removed, a subtask created, moved or cancelled — keyed on `estimate_hash`, so
an edit the model does not read never reaches it and one that leaves the
inputs unchanged is a comparison. A `model` row is written only when the
output moves: another level, the forecast appearing or going, its p50 moving
more than ×1.1, or the subtask count. A done or cancelled task keeps the
estimate it has. The **nightly refit** (§11.6) fits each project again from its
history and recomputes every open task against it. **Best effort, never the
reason a task write fails:** each inline computation runs in a savepoint, and a
failure is logged (`estimate.failed`) and leaves the task write and its
activity row standing; the refit computes what was missed.

**Build time** is first start (`started_at`) to first finish — the task's
first move into review or done. **Review wait** (every stretch in review) and
**rework** (from a send-back to the next finish) are reported beside it, never
folded in (D-085 item 3).

**Cold start.** Below 10 finished tasks with a build time, a project's sizes
are from the text alone, against its typical task's text, and no hours are
shown (D-085 item 6). From 10 the forecast is a p50–p80 range, both ends
calibrated on the model's own past errors — the p50 moved by their median, so
"likely" means what happens now, not what happened when the history was made.

**It must beat the median.** Each refit replays the project's history in time
order — each task predicted only from tasks finished before it started — and
compares the typical error with the plain project median's. A model that does
not beat the median forecasts the median's range instead, and says so.

**A parent's figures come from its children** (D-085 item 7): its weight is the
larger of its own and its non-cancelled children's sum, and its range adds the
children's as distributions (by their mean and variance), not by summing
medians.

**Frozen at claim.** `estimate_at_start_id` is the newest `model` row written
at or before `started_at` — the estimate in force when work first started, by a
claim or any move into `in_progress` — and is never moved once set. A freeze a
failure skipped is made by the next refit by the same rule, so it can never
take an estimate written after work began; a task that started before any
estimate existed for it has none, and is not measured.

**A person's size** is a `person` row and `tasks.size_override_id`; anyone with
`task.write` may set or clear it, it is what is shown, and the computed size
stays beside it. Setting it writes `task.updated` with `{ field: 'size', from,
to }` — not a new verb (D-027's shape). A `model` row writes no `activity`: it
is derived, as `ready` is.

**Tokens (LAI-772).** Each `model` row carries a build-token range computed
with the hours, so the claim freezes both. The calibration is per project:
the log of a finished task's **build tokens** (§4.33's input + output + cache
writes, on days up to its first finish's UTC day) against the log of its size
weight at the start, slope pulled towards 1. It learns **only from attributed
actuals**: a task counts when at least 70% of what its people spent on those
days was tied to a task, and in proportion to that share — a figure that is
mostly missing would teach it that tasks cost little. Tokens are forecast once
10 such tasks exist (D-085 item 6), calibrated and checked against the plain
median exactly as the hours are, and fall back to the median's range when the
size does not explain them. A row is also written when the token p50 moves
more than ×1.1, or appears.

**The claimant's estimate (LAI-772, §4.34)** moves a forecast only once the
project's claimants' sizes have beaten the plain median over at least 10
finished tasks; it is then blended in log space by inverse variance against
the model's own error (at most 0.9), recorded in the *why* as an `agent`
factor, and frozen with the rest. Until then its weight is 0.

**Scope grew after start** is shown when the computed level is a level or
more above the frozen one; an XL task carries a **split suggestion** with the
mean rounds finished XL tasks here took (from three of them). Both describe the
task, never its author.

### 4.33 `token_usage_days`

Agents' token usage per day, as one machine last reported it (§6.4, D-084,
LAI-769) — the Usage page and the profile's token card.

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `collector_id` | the collector's UUID v4, as §4.23's — or `telemetry` for the part OpenTelemetry adds over the session files (LAI-773, §4.38): not a UUID, so never a machine's |
| `day` | `YYYY-MM-DD` in the machine's own time zone |
| `agent` | an agent slug (§9.3): `claude-code`, `codex`, `gemini-cli`; anything else is `other` |
| `model` | the model id the agent recorded, lower case, `[1m]`-style suffixes removed — 1–64 of `a–z`, `0–9`, `.`, `_`, `:`, `-` |
| `task_id` | nullable, FK `tasks`, set null — the task the tokens were spent on, when the collector knew its key and the sender may read it; null is **unattributed**. The collector takes the key from the agent's own mark in the session, or from a key in the branch name (§6.4, D-084 item 5, LAI-770) |
| `project_id` | nullable, FK `projects`, set null — the task's project, copied when it is resolved |
| `input` | integer — uncached input tokens |
| `output` | integer — output tokens, reasoning included |
| `cache_write` | integer — tokens written to the prompt cache |
| `cache_read` | integer — tokens read from it; never in a headline (D-084 item 8) |
| `automated` | boolean, default false — spent by an automated session on that machine (`OMNIGENT=1` sub-agents, `CI`, `LAIKA_ACTIVITY_SKIP`; D-091, LAI-815): the organisation's, the space's and the task's, never a person's |
| `updated_at` | integer — when this snapshot arrived |

No primary key but the rowid: a key over the nullable `task_id` would not hold
in SQLite, so the service folds a report to one row per (`user_id`,
`collector_id`, `day`, `agent`, `model`, `task_id`, `automated`) before
writing.

**An automated row counts for the organisation, the space and the task, and
for no person** (D-091, amending D-086). It is in every organisation, space
and task figure — totals, trend, agents, models, top tasks, cost, cache,
rework, accepted cost, budgets, runaway alerts, forecasts' actuals — and in
no per-person one: `by_developer`, the profile's card, the task panel's
`by_person` and `attributed`, and the plan-limit rate (§4.42) read only rows
with `automated` false. The rows stay under the person's `user_id`, since
their machine sent them: what is held for them (§6.4's `GET
/me/local-activity`) and *delete my history* reach them too.

**Counts only** — there is deliberately no column that could hold a prompt, a
reply, a tool's input, a path, a repository, a branch or a session id; a task
is Laika's own, resolved on the way in. **A snapshot per (person, collector,
day)**: a usage report deletes that day's rows for the machine and writes its
rows, so a retry never counts twice and a model gone from the day is gone from
the table. Machines sum. A day reported as a backfill (§6.4) also replaces the
other collectors' rows for its agents, so the same machine under a new
collector id is never counted twice. Every read is a range of one index
(§4.13) — a task's (`GET /tasks/:id/usage`, LAI-770) on `task_id`. Kept 400
days (§11.6). The day and project indexes carry `automated` as their last
column, so `by_developer`'s read of a person's own rows is still one range
that never touches the table.

### 4.34 `task_claim_estimates`

What the one claiming a task said about it when they claimed it (D-085 item 4,
LAI-772) — `start_working`'s optional `estimate`, and `POST /tasks/:id/claim`'s.
**Append-only**, with `task_estimates`' three triggers (re-established at
every boot): it is what was said, kept to be scored against what happened.

| field | notes |
| --- | --- |
| `id` | ULID |
| `task_id` | FK `tasks`, `ON DELETE RESTRICT` |
| `level` | nullable — `XS` \| `S` \| `M` \| `L` \| `XL`, relative to the project's typical task |
| `confidence` | nullable — `green` \| `yellow` \| `red`: how sure the claimant is it will land as asked |
| `client_name` | nullable — the agent's own name for itself when it claimed (D-076) |
| `created_at` | |

At least one of `level` and `confidence` (CHECK). **No column names a
person**: the claim's own `task.status_changed` row says who claimed. A resume
— the holder's own `start_working` on a task already in progress — keeps
none. Written best effort after the claim's activity row, so an estimate that
cannot be stored never costs the claim.

**Scored per project, never per person.** Sizes: against build times, the
plain median and the model, through the model's calibration at the start
(§4.32); the weight earned is the accuracy view's `agent.size.weight`.
Confidence: of the tasks claimed with each and decided at least once, how many
were sent back (`agent.confidence`). The estimate in force is the newest at or
before `started_at`, as the freeze reads its rows.

### 4.35 `org_model_prices`

An organisation's own API-equivalent price for a model (D-084 item 10,
LAI-773), over the dated table in the code (`services/model-prices.ts`): what
an owner or admin entered on the Organisation page, on a web session. It wins
for its model; deleting it goes back to the table's price, or to none.

| field | notes |
| --- | --- |
| `org_id` | FK `orgs`, cascade |
| `model` | a model id as §4.33 holds it; with `org_id`, the primary key |
| `input` | real — USD per million uncached input tokens, 0–10,000 (CHECK, as for the other three) |
| `output` | real — USD per million output tokens |
| `cache_write` | real — USD per million cache writes, at the five-minute rate |
| `cache_read` | real — USD per million cache reads |
| `set_by` | FK `users` |
| `updated_at` | |

**The code's table** names each row's source page and the day it was read
(2026-10-18: Anthropic's pricing page; OpenAI's for its listed models), and
says when a row was **inferred** — a model the source does not list, priced as
its nearest listed sibling — rather than read; every cost figure built on one
says so (`unconfirmed_models`). **Cache writes are priced at the five-minute
rate**: neither the session files nor the telemetry split a write by how long
it is kept, and the lower rate keeps the figure a floor. **A model with no
price shows no price, never zero.** Nothing fetches a price (§13.4).

### 4.36 `token_budgets`

A soft token budget a lead set (LAI-773): for one task, for a sprint, or for a
project per calendar month. One row per subject; a change updates it.

| field | notes |
| --- | --- |
| `id` | ULID |
| `project_id` | FK `projects`, cascade |
| `scope` | `task` \| `sprint` \| `project` |
| `task_id` | nullable, FK `tasks`, cascade — set exactly when `scope` is `task` (CHECK); unique |
| `sprint_id` | nullable, FK `sprints`, cascade — set exactly when `scope` is `sprint` (CHECK); unique |
| `tokens` | integer, 1 to 10¹² — headline tokens: input + output + cache writes (D-084 item 8), the forecast's own unit |
| `set_by` | FK `users` |
| `created_at`, `updated_at` | |

**What each counts.** A task: every token tied to it (§4.33), all days. A
sprint: the tokens tied to its tasks on the sprint's days — `starts_on` to
`ends_on` as UTC dates. A project: the tokens tied to its tasks in the
calendar month, UTC. **A task without a row has the p80 of the token forecast
frozen at its claim as its budget** (§4.32), computed, never stored, and none
without one. **Soft**: crossing 80% and 100% raises an alert once (§4.37),
and nothing is refused to anybody — no report, claim, move or save.

### 4.37 `token_alerts`

A soft alert, raised once (LAI-773): a budget crossed at 80% or 100%, or a
**runaway agent** — a claimed task past the p95 of its frozen token forecast
with nothing landing for an hour (§6.4).

| field | notes |
| --- | --- |
| `id` | ULID |
| `kind` | `budget` \| `runaway` |
| `scope` | `task` \| `sprint` \| `project` — a runaway alert is always a task's (CHECK) |
| `project_id` | FK `projects`, cascade |
| `task_id` | nullable, FK `tasks`, cascade |
| `sprint_id` | nullable, FK `sprints`, cascade |
| `subject_id` | the task, sprint or project id — what the alert is about |
| `period` | `YYYY-MM` for a project's monthly budget; empty otherwise |
| `threshold` | `80` or `100` for a budget, `95` for a runaway (CHECK) |
| `limit_tokens` | the budget, or the p95, in force when it was raised |
| `tokens` | what had been spent when it was raised |
| `user_id` | nullable, FK `users`, cascade — a runaway alert's **one recipient**, the assignee when it was raised; null on a budget alert (CHECK) |
| `created_at` | |

**Raised once**: a budget alert is unique per subject, period, threshold and
the budget in force, so a lead raising a budget re-arms it; a runaway alert is
one per stall — none is raised while one newer than the task's last progress
exists. **No `activity` row and no comment**: there is no honest author for a
comment Laika writes itself (`comments.created_via` has no value for it), a
comment or a row in the feed would show a runaway alert to the whole project
before its assignee, and a new §4.8 verb is an `activity` rebuild (D-087).

### 4.38 `token_session_days`

Per-session token totals by day, from the two sources that can describe the
same Claude Code session (D-087, LAI-773): the session files a collector read,
and the OpenTelemetry metrics Claude Code sent. Matched by a **one-way key**,
never the session id.

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `source` | `files` \| `telemetry` |
| `collector_id` | the collector, for `files`; empty for `telemetry` |
| `day` | `YYYY-MM-DD` — for `files`, the machine's day the reply was written; for `telemetry`, the day its export interval ended, in the zone the person's usage reports state (§4.44) — else their latest §4.23 snapshot's, else UTC |
| `session_key` | the first 16 hex of `sha256("laika-session:" + session id)` — computed by the collector and by the receiver; the id itself is never stored |
| `model` | as §4.33 |
| `input`, `output`, `cache_write`, `cache_read` | integers |
| `cost_usd` | nullable real — Claude Code's own `claude_code.cost.usage` for the session, telemetry rows only |
| `updated_at` | |

Primary key (`user_id`, `day`, `source`, `collector_id`, `session_key`,
`model`). `files` rows are replaced per (person, collector, day) by each usage
report, as §4.33's are; `telemetry` rows grow as metrics arrive.

**The gap is matched per session over its whole span, then floored** (review
B1). The files put a reply on the day it was written and telemetry on the day
its export ended — up to a minute later — so across midnight, or in another
zone, the same tokens sit on two days, and a floor taken per day counts them
twice. So, per person and model, for each count, the gap is
`max(0, Σ_session max(0, telemetry − files) − unplaced)`, where each
session's `telemetry` and `files` are totalled over **every day it has rows
on**, and `unplaced` is the Claude Code file tokens no listed session holds on
those days and the days beside them. Only then is it spread back onto the days
where a session's telemetry ran ahead of its files, in proportion, in whole
tokens. It is written to §4.33 under collector `telemetry` and recomputed
whenever either side moves, for the days moved, the days beside them, and
every day a telemetered session on them reaches. So every read of the rollup
sees, per session, the larger of the two, and a token is never counted twice:
subtracting the unplaced tokens can only under-fill the gap. If the match
fails, the report it rides on is still taken and the person's gap rows are
removed — an under-count, never a double one (§6.4). Kept 40 days (§11.6).

### 4.39 `token_telemetry_series`

Where each OpenTelemetry series stood (LAI-773), so a retried or repeated
export never adds twice.

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `series_key` | session key, model, the count, and a cumulative series' start time |
| `last_value` | real — a cumulative series' largest value |
| `last_end_ms` | integer — where the last interval taken ended |
| `updated_at` | |

A **cumulative** point adds only its growth over `last_value`; a **delta**
point is taken only when it starts at or after `last_end_ms`. A point out of
order can only be dropped, never counted twice. **A cumulative series first
seen more than five minutes after it began is a baseline**: its first value
holds everything since its process started — possibly before Developer insights was on —
so only its growth from there is counted. (A delta point from before Developer insights was on
was refused when it was sent, and is never resent.) Kept three days past its last
point.

### 4.40 `token_session_skips`

The sessions whose telemetry a collector asks to be left out, by one-way key
(LAI-773): automated ones (D-086), whose tokens arrive as rows marked
`automated` (D-091, §4.33), and those outside the developer's `laika-repos`
scope (D-079 item 4), whose tokens are not sent.

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `session_key` | as §4.38 |
| `created_at` | |

Telemetry for a listed key is dropped on arrival, and what it had added
before the key arrived is removed with it. Kept 45 days, as the collector
keeps its list.

### 4.41 `plan_limits`

A developer's own plan limit (D-087, LAI-773). **Read and written only by the
person, on a web session**: no admin read, no other endpoint, no token.

| field | notes |
| --- | --- |
| `user_id` | primary key, FK `users`, cascade |
| `plan_kind` | `claude-pro` \| `claude-max-5x` \| `claude-max-20x` \| `other` — a label; **no plan carries a token figure** |
| `limit_window` | `5h` (rolling) \| `day` \| `week` |
| `limit_tokens` | integer, 1 to 10¹² — the developer's own number, headline tokens |
| `week_reset_day` | nullable — 0 (Sunday) to 6; set exactly when `limit_window` is `week` (CHECK) |
| `week_reset_minute` | nullable — minutes after midnight, 0–1439, in `tz` |
| `tz` | the IANA zone the window is read in |
| `updated_at` | |

### 4.42 `token_arrivals`

When a person's tokens reached the board, in five-minute buckets (D-087,
LAI-773): the rate the plan-limit forecast reads. Each usage report and each
telemetry export adds what it changed in the person's own headline tokens for
today and yesterday — never an automated session's (D-091, §4.33); a
backfilled day adds nothing.

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `bucket_ms` | unix ms, a multiple of five minutes; with `user_id`, the primary key |
| `tokens` | integer, ≥ 0 |

Read only by the person's own `GET /me/plan-limit`. Kept eight days.

### 4.43 `token_alert_dismissals`

A person putting an alert away for themselves (LAI-773).

| field | notes |
| --- | --- |
| `alert_id` | FK `token_alerts`, cascade |
| `user_id` | FK `users`, cascade |
| `created_at` | |

### 4.44 `token_usage_zones`

The zone a person's usage reports state (LAI-773, review B1), so telemetry is
put on the same days the files are.

| field | notes |
| --- | --- |
| `user_id` | primary key, FK `users`, cascade |
| `tz` | the IANA zone the person's latest usage report stated (§6.4's `tz`) |
| `updated_at` | |

Written by every usage report, before its sessions are matched; read when
telemetry arrives, to bin each point's day. Deleted with the person's history
(`DELETE /me/local-activity`) and with the person.

### 4.45 `org_time_settings`

The organisation's *Time* (D-088 item 5, LAI-787). **No row is `off`.** Set
by an owner or admin on a web session (`org.time.set`, §3.1).

| field | notes |
| --- | --- |
| `org_id` | primary key, FK `orgs`, cascade |
| `mode` | `off` \| `manual` \| `drafts` — `manual`: people type their own entries; `drafts`: their collectors may also draft their day |
| `closed_through` | nullable `YYYY-MM-DD` — the last day of the closed period (LAI-788). On or before it a Solidtime change is flagged, never taken, and nothing is written to Solidtime (D-088 item 6). Set by LAI-789's month close; null until then |
| `breaks` | nullable JSON text — the organisation's break schedule (D-101, LAI-955): a list of `{ label, start, end, days }`, `start`/`end` wall-clock `HH:MM` with no zone, `days` ISO 1 (Mon) – 7 (Sun). Null is no schedule. Set by `PUT /org/time/breaks`; display only — nothing that drafts or counts time reads it |
| `updated_at` | |

Leaving `drafts` deletes every draft anybody has not confirmed (§4.47), in the
same transaction; a confirmed one stays, its evidence blanked, so its block is
not drafted again when drafting is turned back on. A table rather than an
`orgs` column so the change is additive.

### 4.46 `user_time_settings`

A person's own *Draft my time* (D-088 item 5, LAI-787) and where they are
(D-106, LAI-895). **No row is off, and nowhere.** Set only by the person, on a
web session (`time_settings.set_own`).

| field | notes |
| --- | --- |
| `user_id` | primary key, FK `users`, cascade |
| `draft_my_time` | 0 or 1 (CHECK) |
| `place` | text, null — the IANA zone of a place from the client's list (`Asia/Kolkata`), at most 64 characters; the person's Timeline computes its sunrise and sunset from it (D-106). The server stores the id and reads nothing into it |
| `updated_at` | |

Turning it off deletes every draft the person has not confirmed, in the same
transaction, and blanks a confirmed one's evidence — as §4.45 does. Drafting
needs both this and §4.45's `drafts`.

### 4.47 `time_drafts`

A person's drafted time (D-088 items 3, 11 and 13, LAI-787): a block their own
collector drafted on their machine, or an entry an agent proposed. **Read only
by the person, on a web session** — no token reads one and there is no admin
read. Counts of the signals behind a block, which five minutes its prompts
and commits fell in (D-096), and — since D-098 — the **name the person gave
the work folder** it was drafted in, with that folder's branch only when they
turned sending it on; nothing else. No column can hold a prompt, a path, a
folder's own name, a repository or a window title, and the branch only as
the person chose to send it.

| field | notes |
| --- | --- |
| `id` | ULID |
| `user_id` | FK `users`, cascade |
| `source` | `collector` \| `agent` |
| `collector_id` | the collector's random UUID; empty for an agent's proposal, or once the person edited the block |
| `day` | `YYYY-MM-DD`, the person's local day in `tz` (D-088 item 12) |
| `tz` | IANA zone |
| `started_at` | nullable — unix ms; null for a proposal of minutes alone |
| `ended_at` | nullable — set exactly when `started_at` is, and after it (CHECK) |
| `minutes` | 1–1440 (CHECK) |
| `task_key` | nullable — the key as sent, when it names no task the person can read |
| `task_id` | nullable FK `tasks`, set null |
| `project_id` | nullable FK `projects`, set null |
| `general` | 0 or 1 — put on no card and no project by the person, on purpose |
| `signals` | JSON `{ prompts, replies, sessions, commits, marks, at? }` — counts, and `at` `{ prompts?, commits? }`: `[bucket, count]` pairs, a bucket being five minutes of unix time, `floor(ms / 300000)` (D-096, LAI-834). Numbers only |
| `note` | nullable — an agent's proposal may say what it was for, ≤ 200 characters |
| `folder` | nullable — the name the person gave the block's work folder on their machine (D-098, LAI-866): 1–60 characters, no `/` or `\`, no control or format character — a name, never a path. Bounded by the service on every way in (the upload and `PATCH`), not by a CHECK, which would rebuild this table |
| `branch` | nullable — that folder's branch, only when the person turned sending it on (D-098 item 3), and only beside a `folder`; `[A-Za-z0-9._/-]`, 1–255 |
| `state` | `pending` \| `confirmed` \| `dismissed` |
| `entry_id` | nullable FK `time_entries`, set null — what a confirmed draft became |
| `origin_id` | nullable — a collector block's **origin**: the id of the row as first stored, shared by the halves of a split; null for an agent's proposal |
| `origin_task` | nullable — the origin's key as the collector sent it; null for an untied block |
| `origin_started_at`, `origin_ended_at` | nullable — the origin's span, set exactly when `origin_id` is, end after start (CHECK) |
| `origin_minutes` | nullable — the origin's minutes, 1–1440 (CHECK) |
| `created_at`, `updated_at` | |

Indexes: `(user_id, day)` — My day and its week — and `(day)` for retention,
with each FK's.

**A re-sent day is measured by origin** (LAI-787 review B1). The collector
sends one block per task per stretch, so the blocks of tasks worked in
parallel overlap. An upload replaces **its own unheld pending** blocks for each
day it carries; every other row of the day that came from a block — confirmed,
dismissed, held after the person's edit or split, or another machine's — is
measured against by its origin, which no edit changes. A new block loses what
origins of the **same task** overlapping it hold, each in proportion to how
much of its span lies in the block; and the blocks of a stretch (spans that
touch or overlap) keep no more than the stretch's own minutes less what is
settled across it, of any task. **Minutes are taken off, never span**: a
settled block costs another task's block nothing; a confirmed draft is
measured against for as long as it is kept, so deleting its entry or moving it
to another day does not bring the block back; an edit is never overwritten;
and two machines working the same hours draft them once, never twice. Entries
are not consulted: a timeless manual entry overlaps nothing it could be
compared with, and the day's 1440 minutes (§4.48) keep the two from being
confirmed past a day. Kept 30 days (§11.6); the person may delete their
unconfirmed drafts at any time (`DELETE /me/time-drafts`), and a confirmed one
stays until retention.

### 4.48 `time_entries`

Confirmed time (D-088 items 2, 11 and 12, LAI-787): what a person confirmed
from a draft, typed, or imported — **the only time anyone but the person will
ever see.** On a task, a project, or neither (*General*). Writes no `activity`
row.

| field | notes |
| --- | --- |
| `id` | ULID |
| `user_id` | FK `users` — no `ON DELETE`: people are deactivated, never deleted |
| `task_id` | nullable FK `tasks`, set null |
| `project_id` | nullable FK `projects`, set null — the task's project when there is a task |
| `day` | `YYYY-MM-DD`, the person's local day in `tz` |
| `tz` | IANA zone, stored per entry; the board stays UTC |
| `started_at`, `ended_at` | nullable, together, end after start (CHECK) — a confirmed block keeps its span |
| `minutes` | 1–1440 (CHECK); a person's live entries on one day sum to at most 1440 (`422 day_full`) |
| `source` | `draft` \| `manual` \| `import` — an `import` came from Solidtime and is read-only here: changed in Solidtime, and taken by the next pull (LAI-788) |
| `source_ref` | nullable — the draft it came from, or an import's own id (LAI-788); unique per `(user_id, source)` where set |
| `note` | nullable, ≤ 280 characters |
| `kind` | nullable — what the person said it was (D-108, LAI-897; the design's eight since LAI-516): `work` \| `meeting` \| `thinking` \| `research` \| `pairing` \| `review` \| `support` \| `admin` — validated by the API on every path (no CHECK here: SQLite cannot add one without rebuilding a table that carries retention triggers; `time_timers.kind` carries it). Null on a confirmed draft, an import, and an entry nobody typed a kind for; the Timeline colours a block by it. Migration 0060 mapped the first eight: call → meeting, planning → thinking, learning → research, other → work |
| `title` | nullable, ≤ 120 characters (CHECK) — the person's own name for it, shown where a card's key would be when there is no card |
| `description` | nullable, ≤ 2000 characters (CHECK) — what it was, in their words; `note` stays the one line Solidtime gets when there is no title |
| `folder`, `branch` | nullable — a confirmed draft's work folder name and branch (§4.47, D-098 item 5), carried into the entry when the person confirms it and seen with it by owners and admins, as confirmed hours are (D-088 item 7); null for a typed or imported entry. Not part of a revision (§4.49) |
| `revision` | integer ≥ 1, its newest revision's number |
| `deleted_at` | nullable — a person's delete keeps the row |
| `created_at`, `updated_at` | |

Indexes: `(user_id, day)`, `(project_id, day)`, `(task_id)`, `(day)`. **Kept
three years** (BCEA s31): a trigger refuses deleting a row whose `day` is not
yet three years old, and another refuses `INSERT OR REPLACE` over any entry —
by its `id` or its `(user_id, source, source_ref)` — which removes the row
without firing a delete trigger and would take its revisions with it (LAI-787
review B2). So only §11.6's retention removes one, its revisions with it;
`runMigrations` re-checks both triggers at every boot.

### 4.49 `time_entry_revisions`

Every change to a time entry, as the entry stood after it (D-088 item 6,
LAI-787). **Append-only**: triggers refuse `UPDATE`, an `INSERT OR REPLACE`
over an existing id, and `DELETE` while its entry exists.

| field | notes |
| --- | --- |
| `id` | ULID |
| `entry_id` | FK `time_entries`, cascade |
| `revision` | integer; `(entry_id, revision)` unique |
| `change` | `created` \| `edited` \| `deleted` |
| `changed_by` | FK `users` |
| `task_id`, `project_id` | nullable — **copies, no FK**: history says what the entry said, and a deleted task must not rewrite it |
| `day`, `tz`, `started_at`, `ended_at`, `minutes`, `note`, `kind`, `title`, `description` | the entry after the change |
| `created_at` | |

### 4.50 `agent_time_days`

Claude Code's own `active_time` per session and day (D-088 item 8, LAI-787):
`user`, time at the keyboard in Claude Code, apart from `cli`, the agent
working. From D-087's OTLP receiver, under the organisation's switch. **Agent minutes,
never hours**; nothing adds them to a time entry.

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `day` | in the zone telemetry is read in (§4.44) |
| `session_key` | as §4.38 — a one-way key, never the session id |
| `kind` | `user` \| `cli` |
| `seconds` | real, ≥ 0 |
| `updated_at` | |

Primary key `(user_id, day, session_key, kind)`. A session the collector left
out (§4.40) has its rows dropped and none added. Kept 400 days with the token
rollup, and deleted with the person's history (`DELETE /me/local-activity`).

### 4.51 `token_session_tasks`

How a Claude Code session's tokens of a day split between tasks, by one-way
key (D-088 item 8, LAI-787): what ties its agent minutes to cards the way its
tokens are tied (D-084 item 5).

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `collector_id` | the reporting collector |
| `day` | as the usage report's |
| `session_key` | as §4.38 |
| `task_id` | FK `tasks`, cascade — only a key the sender may read is kept |
| `tokens` | headline tokens the session spent on it, ≥ 0 |
| `updated_at` | |

Primary key `(user_id, day, collector_id, session_key, task_id)`. Replaced per
(person, collector, day) with each usage report, as its rows are; kept 400 days
and deleted with the person's history.

### 4.52 `solidtime_projects`

Which space a Solidtime project's hours belong to (D-088 item 10, LAI-788).
**Many Solidtime projects to one space** — a customer's *build* and *support*
may be two projects there and one space here. Set by an owner or admin, signed
in, from the CLI that can see Solidtime (`time_sync.map`); the server never
calls Solidtime.

| field | notes |
| --- | --- |
| `solidtime_project_id` | primary key — Solidtime's project id |
| `project_id` | FK `projects`, cascade — the space |
| `name` | the project's name in Solidtime, 1–255 characters, so a list says what was mapped |
| `push` | 0 or 1 — the one its space's confirmed time is written to when several map to it; at most one per space (partial unique index) |
| `updated_by` | FK `users` |
| `updated_at` | |

A space with one Solidtime project pushes there; with several, to the one
marked `push`, and holds its time until one is (§6.4). Rates and amounts are
Solidtime's and never stored (D-088 item 10).

### 4.53 `solidtime_people`

A Solidtime member who is a Laika person (D-088 item 10, LAI-788): **suggested
by email on the CLI's machine, confirmed by an owner or admin, signed in.**
Only the confirmation reaches the board — neither side's email. A member with
no row is one of the *people not on Laika* (§4.54).

| field | notes |
| --- | --- |
| `solidtime_member_id` | primary key — Solidtime's member id, not its user id |
| `user_id` | FK `users`, unique — one member per person |
| `confirmed_by` | FK `users` |
| `confirmed_at` | |
| `updated_at` | |

Undoing a link moves the hours it brought in back to *people not on Laika*:
each imported entry is deleted from the person's time with a revision. Nothing
in the closed period moves.

### 4.54 `solidtime_entries`

Every Solidtime entry the board knows (D-088 items 6 and 10, LAI-788): **what
Laika last took from it or wrote to it.** Solidtime has no webhook, no
`updated_at`, no soft delete and no idempotency key, so a pull re-reads a
window whole and compares — a different `hash` is an edit, an id missing is a
delete — and the same entry is never written twice, whoever's CLI reads it.

| field | notes |
| --- | --- |
| `solidtime_id` | primary key — Solidtime's entry id |
| `member_id` | the Solidtime member it is of |
| `user_id` | nullable FK `users` — the Laika person; null for *people not on Laika* |
| `entry_id` | nullable FK `time_entries`, cascade, unique where set — its twin; set exactly when `user_id` is (CHECK) |
| `entry_revision` | nullable — the twin's revision when the two last agreed |
| `hash` | the CLI's SHA-256 of the entry's start, end, project, task and the key read from its description — **never the description** |
| `started_at` | unix ms, Solidtime's start — the window a re-read covers |
| `day` | `YYYY-MM-DD`, its local day |
| `minutes` | 1–1440 (CHECK) |
| `project_id` | nullable FK `projects`, set null — the space |
| `task_id` | nullable FK `tasks`, set null — the card its key names |
| `updated_at` | |

Indexes: `(member_id, started_at)` for the window, `(day)` for retention, and
each FK's. **Once there, Solidtime is the record**: a change Laika has not
seen is taken over Laika's own — an edit the person made since is counted as a
conflict and kept in the entry's revisions — and a Laika change goes out only
while Solidtime still holds what Laika last saw. A person's rows go with their
entry; *people not on Laika* are kept three years by §11.6, as entries are.

### 4.55 `time_breaks`

A gap in a person's day that they waved away as a break (LAI-831, CHIEF's
addition D): a span on their local day that My day stops counting under
*Gaps* and stops offering to fill. **Never time** — no total, entry, report or
export reads it, and adding or removing one touches no draft and no entry.
**The person's own, on a web session**, as a draft is: read with their day
under `time_drafts.read_own`, added and removed under `time_drafts.manage_own`
(§6.4); anybody else's is not there for them.

| field | notes |
| --- | --- |
| `id` | ULID |
| `user_id` | FK `users`, cascade |
| `day` | `YYYY-MM-DD`, the person's local day in `tz`, as a draft's |
| `tz` | IANA zone |
| `started_at`, `ended_at` | unix ms, end after start (CHECK); the service keeps both on `day` in `tz` |
| `created_at` | |

Indexes: `(user_id, day)` — My day — and `(day)` for retention. A day holds
at most 48, none overlapping another (§6.4). Kept 30 days, as drafts are
(§11.6), whatever happens to the drafts: neither switch nor
`DELETE /me/time-drafts` removes one.

### 4.56 `time_undo`

What a change to a person's own time replaced (LAI-831, CHIEF's addition B),
written in the change's own transaction so *Undo* puts back **exactly** what
was there: a held block's collector, a split block whole under its own id, a
confirmed draft pending. **Kept minutes, not days**, and the person's own —
read only by their own `POST /me/time/undo` (§6.4).

| field | notes |
| --- | --- |
| `id` | ULID — the change's id, which its write answers with in `X-Undo-Id` (§6.4) |
| `user_id` | FK `users`, cascade |
| `subject` | what the change was asked of: a draft's id, an entry's id, or `day:YYYY-MM-DD` for *Confirm day* |
| `change` | JSON: `drafts`, each draft the change touched as it stood before, column for column; `made`, the drafts only the change made (a split's halves); `entriesMade`, the entries it made live (a confirm, an add); `entriesRetired`, the entries it took back (a delete) |
| `created_at` | the instant of the change; every row it wrote carries it as `updated_at`, which is how Undo tells that nothing has changed since |

Indexes: `(user_id, subject)` and `(created_at)` for retention. Kept for
`UNDO_WINDOW_MS`, two minutes — My day offers Undo for ten seconds, and the
rest is a slow network's. A new change sweeps the person's rows older than
that, and an Undo deletes its own. `DELETE /me/time-drafts` and *Draft my
time* turned off delete the person's with their drafts, and the organisation
leaving `drafts` deletes everybody's (§4.45, §4.46), because a before-image
holds a block's counts (§4.47). §11.6 sweeps everyone's.

### 4.57 `agent_time_buckets`

When the agent worked (LAI-833): the seconds of Claude Code's `active_time` of
`type=cli` (the agent working, never the keyboard) per session and five
minutes of unix time. They come from the same OTLP receiver as §4.50, from the
times its points already carry. Each point's added seconds are spread over the
buckets its interval covers, in proportion. Seconds past the interval's length
are put in the stretch that long before its end, so a bucket never holds more
than five minutes. They draw My day's AGENTS lane, `agent.lane` in `GET
/me/time`: per bucket of the day in the requested zone, `[bucket start in unix
ms, seconds, seconds on a card]`, where a bucket is on a card when its
session's own split ties it (§4.51). **Agent minutes, never hours.**

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade |
| `session_key` | as §4.38 — a one-way key, never the session id |
| `bucket` | integer — `floor(unix ms / 300000)` |
| `seconds` | real, 0–300 (CHECK); an upsert adds and stops at 300 |
| `updated_at` | |

Primary key `(user_id, session_key, bucket)`; index `(user_id, bucket)`, one
range per day. A session the collector left out (§4.40) has its rows dropped,
and none are added. Kept 40 days (§11.6), and deleted with the person's
history (`DELETE /me/local-activity`).

### 4.58 `org_role_grants`

What the owner has granted each org role (D-102 rule 6, LAI-958; §3). **No
row is the default** — admin on, member and viewer off — so an organisation
whose owner never changed them has none. Written whole by `PUT
/org/permissions` (owner only, session only), and read with the actor on
every request so a withdrawn grant takes effect at once.

| field | notes |
| --- | --- |
| `org_id` | FK `orgs`, cascade |
| `org_role` | `admin` \| `member` \| `viewer` (CHECK) — never `owner`, who holds every capability |
| `capability` | `see_people_analytics` \| `see_org_activity` \| `open_all_projects` \| `manage_people` \| `change_org_settings` (CHECK); what each carries is §3's |
| `granted` | 0 or 1 (CHECK) |
| `set_by` | FK `users` — the owner who saved it |
| `updated_at` | |

Primary key `(org_id, org_role, capability)`; index `(set_by)`. A change
writes one `member.role_changed` row, org-scoped, with `payload.scope:
"org_permissions"` and the whole matrix `from` and `to` (§4.8).

### 4.59 `analytics_views`

Who looked at a person's analytics, and when (D-102 rule 3, D-088 item 7,
LAI-957; §3.1's *"View a member's day, time and shared activity"*). One row
per read of somebody else's My day, local activity, heatmap or per-person
tokens, written in the same transaction as the read; a person reading their
own writes none. Read by the person alone, `GET /me/analytics-views`. No
`activity` row: §4.8 gains no verb. Kept **400 days** (§11.6's local-activity
retention, by `viewed_at`).

| field | notes |
| --- | --- |
| `id` | ULID |
| `viewer_id` | FK `users` — who looked |
| `subject_id` | FK `users`, cascade — whose analytics |
| `kind` | `time` \| `local_activity` \| `activity` \| `usage` (CHECK) |
| `day` | nullable `YYYY-MM-DD` — the day read, for `time`; null for a range |
| `viewed_at` | |

Indexes `(subject_id, viewed_at, id)` for the person's list, `(viewer_id)`,
`(viewed_at)` for retention.

### 4.60 `password_resets`

One-time password-reset links an admin issued for somebody (D-104 item 4,
LAI-983). Laika sends no email, so whoever holds *Deactivate people and reset
access* issues a link (§3.1 *Issue a password-reset link*), shown once, and
hands it over. **The rows
are the log** of who issued a link for whom and whether it was used, as
`analytics_views` is for reads: §4.8 gains no verb. Issuing a link revokes the
person's earlier unused ones.

| field | notes |
| --- | --- |
| `id` | ULID |
| `user_id` | FK `users`, cascade — whose password it resets |
| `token_hash` | SHA-256 of the token, unique; the token itself is never stored (§13.1, as §4.11) |
| `created_by` | FK `users` — who issued it |
| `expires_at` | at most 24 hours after `created_at` |
| `used_at` | nullable — when it set a password; a used link never works again |
| `revoked_at` | nullable — when a newer link for the same person replaced it unused |
| `created_at` | |

Indexes: unique `(token_hash)`, `(user_id)`, `(created_by)`.

### 4.61 `time_timers`

A person's running timer (D-110 item 1, LAI-500): the design's *Start timer*
— a task, a kind and a title, all optional; pause; resume; stop. **One row per
person while it runs, none when it does not**: start inserts, stop and discard
delete, so the row's existence is the timer's. Kept on the server so a reload
or another device shows the same clock. The time run is `accumulated_ms` plus,
while `paused_at` is null, now minus `resumed_at`.

| field | notes |
| --- | --- |
| `user_id` | PK, FK `users`, cascade — one timer per person |
| `task_id` | nullable FK `tasks`, set null — what it is for, if a card |
| `kind` | nullable, one of §4.48's kinds (CHECK) |
| `title` | nullable, at most 120 characters (CHECK) |
| `tz` | the zone it was started in: its entry's day is the start's day there |
| `started_at` | the first start, unix ms — the entry's span begins here; never moves |
| `resumed_at` | the start of the current running segment; `started_at` until the first resume (CHECK `>= started_at`) |
| `paused_at` | nullable — set while paused, null while running |
| `accumulated_ms` | running milliseconds banked before the current segment (CHECK `>= 0`) |
| `updated_at` | |

**Stopping is `POST /me/time-entries` with the clock filled in** (§6.4): the
entry is written by the same code, `source: 'manual'` (`time_entries.source`'s
CHECK cannot be widened without rebuilding the table, and the title and kind
already say what it was), spanning `started_at` to the stop — or to
`paused_at`, when stopped paused — with the minutes run, and the row is
deleted. Every refusal that path makes leaves the timer standing: a day that
would hold more than a day `422 day_full`; under a minute `422
timer_too_short`. Over confirmed time it saves — time recorded at the same
time is allowed (LAI-528, D-113). A timer that ran past
midnight in `tz` saves as an **untimed** entry on the day it started, the
minutes it ran, and the answer carries `crossed_midnight: true` — the minutes
are what is known, and a span over two days is not one entry. The entry's
`X-Undo-Id` undoes the entry only; the timer is not revived. Behind
`time_entries.write_own`, session only (§3.1): a timer is an own entry in the
making, and no new action would distinguish anything. No retention: a row
lives as long as its timer.

### 4.62 `time_day_notes`

A person's note on one of their days (D-110 item 2, LAI-501): the design's
*Note for your manager*, written with *Confirm day* or on its own, one per
person per day. **Prose, not time**: no total, report or export reads it, and
Undo of the confirm it came with leaves it where it is. Read by the person
with their day, and by owners and admins — whoever holds `people.analytics.read`
— with `GET /people/:id/time`, which answers them the person's own view
(D-102); never a plain member's.

| field | notes |
| --- | --- |
| `user_id` | FK `users`, cascade — with `day`, the primary key: one note per person per day |
| `day` | `YYYY-MM-DD`, the person's local day, as an entry's |
| `note` | 1 to 500 characters (CHECK), trimmed; nothing to say removes the row |
| `created_at` | |
| `updated_at` | |

Indexes: the primary key `(user_id, day)`, and `(day)` for retention. Written
behind `time_entries.write_own`, session only (§3.1): the note is the person's
own account of their own time. §11.6 prunes it with the entries, after three
years.

### 4.63 `agents`

A registered agent (D-114, LAI-534): a named identity owned by one person,
acting through its own tokens (§4.9 `agent_id`) and **never with more access
than its owner**. D-010 still holds — an agent acts as its owner, under its
owner's role; this table only makes it distinguishable, and lets its access be
narrowed (§4.64).

| field | notes |
| --- | --- |
| `id` | ULID |
| `org_id` | FK `orgs`, cascade |
| `owner_user_id` | FK `users`, cascade — the one person whose agent it is; their current permissions cap it |
| `display_name` | 1 to 80 characters, trimmed. An agent's tokens carry it as their `name`, and renaming the agent renames them |
| `harness` | **self-reported**: an `AGENT_CLIENTS` slug or `other`, checked at the API. No CHECK, so a new client needs no rebuild. Decides nothing |
| `device_label` | nullable, at most 80 characters, **self-reported**. Decides nothing |
| `status` | `active` \| `revoked` (CHECK). `revoked` is terminal |
| `created_at` | |
| `revoked_at` | nullable — when it was revoked |
| `last_seen_at` | nullable — the last request on one of its tokens, stamped at most once a minute as `tokens.last_used_at` is |

Indexes: `(org_id)`, `(owner_user_id)`.

**Revoking an agent** sets `revoked` and revokes every live token it holds, in
one transaction; `resolve-actor.ts` refuses an agent's token whose agent is not
`active` before any handler runs, whatever the token row says. **Rotating** one
of its tokens mints a new token and revokes the old one in one transaction,
keeping the old one's scope and project pin; the agent, its grants and its
history are unchanged, and the owner's other tokens are untouched. Both, and
registering, renaming and granting, are behind `agent.manage_own`, session only
(§3.1): no token, an agent's own included, can mint itself more access.
Reading is `agent.read_own`. Every query reaches the caller's own agents only,
and another person's agent is a `404`. **No new §4.8 verb**: minting and
revoking an agent's token write `token.created` and `token.revoked`, the rows
here are the record of the rest, and historic activity is never back-filled
with an agent. No retention: an agent row lives as long as its owner.

**Devices** (LAI-590) are derived from the owner's agents sharing a
normalised device label: ECMAScript `trim().toLowerCase()`, with null and
blank labels sharing the empty key and displayed as *Unnamed device*.
The label remains self-reported and grants no permission. The device list
includes active and revoked agents, their harness and status, counts of each,
and the newest non-null agent last-seen time (null if none was seen).
Recognition is the owner's statement per label (§4.67). A new label starts
unrecognised; agents on labels already present at upgrade start recognised.
Revoking a device uses single-agent revocation for every active agent on that
label in one transaction, ending their sessions with `agent_revoked` so their
claims cease to be live exactly as with single-agent revocation. Other devices,
other owners and personal tokens are untouched. Confirm and revoke use
`agent.manage_own`, session only; list uses `agent.read_own`. A label absent
from the caller's own agents is `404`, including another owner's label.

### 4.64 `agent_project_grants`

What one agent may do in one project (D-114, LAI-534). **No row is no access.**

| field | notes |
| --- | --- |
| `agent_id` | FK `agents`, cascade — with `project_id`, the primary key: one grant per agent per project |
| `project_id` | FK `projects`, cascade |
| `scope` | `read_only` \| `full` (CHECK) — the same two words a token's scope uses, narrowing the same way |
| `created_at` | |

Indexes: the primary key `(agent_id, project_id)`, and `(project_id)`. A grant
may name only a project the owner can read when it is set; `PUT
/agents/:id/grants` replaces the whole set.

**An agent's effective access is the intersection** of its owner's current
permissions, its grant for the project, and its token's scope and project pin —
enforced in `can()`'s token narrowing, so every REST route and every MCP tool
applies it the same way. **An agent's token is pinned to its grants**: in a
project it holds no grant for it is refused (`403`, `reason: agent_not_granted`),
a `read_only` grant keeps the reads (`reason: agent_read_only`), and of the org
actions it keeps only a pinned token's (§6.2) less minting a token and revoking
one of its owner's (`reason: agent_token`). An owner who loses a permission
loses it for every agent at once, because the role is read on every request.
The project's hand-off policy, when it exists, narrows delegation and transfer
only — never a read or a comment.

### 4.65 `agent_sessions`

One running process of a registered agent (proposal §4.2, LAI-541). Opened by
`POST /agent-sessions` or by the agent's own `start_working` (§7.1), kept alive
by heartbeats (§9.1), ended by the agent or by revoking it. A session holds
claims (§4.66); it never holds a task by itself.

| field | notes |
| --- | --- |
| `id` | ULID |
| `agent_id` | FK `agents` (§4.63), cascade |
| `token_id` | FK `tokens` (§4.9), cascade — the credential that opened it. Rotating the agent's token does not end it |
| `started_at` | |
| `last_heartbeat_at` | renewed by every heartbeat; the session is **suspect** once it is older than §9.1's suspect interval — shown, decides nothing |
| `ended_at` | nullable — set with `end_reason`; both or neither (CHECK) |
| `end_reason` | nullable — `ended` (the agent said so) \| `agent_revoked` (D-114 item 2) (CHECK) |
| `client_version` | nullable, **self-reported**, at most 64 characters. Decides nothing |
| `harness` | nullable, **self-reported** (D-118, LAI-586) — the underlying harness that ran, a lowercase slug of at most 64 characters (`codex`, `claude-code`). A manager's agent (`Polly · Belka`) runs workers of other harnesses as its sessions, so this is the session's, not the agent's §4.63 `harness`. Decides nothing |
| `harness_version` | nullable, **self-reported** (D-118) — that harness's version, at most 64 printable characters, no spaces. Decides nothing |
| `model` | nullable, **self-reported**, at most 120 printable characters. Decides nothing. A heartbeat may change it (D-118: *"Changing a model never creates a new agent"*) |
| `context_revision_seen` | nullable — **unwritten** (LAI-555). A revision is a project's and a session may work in more than one project, so what was delivered is kept per session **and project** in §4.69 instead |

Indexes: `(agent_id)`, `(token_id)`. **No activity row**: a session is presence,
as a heartbeat is (§9.1), and the claims it holds are what §4.8 records.
Another agent's session is a `404`.

### 4.66 `task_claims`

An agent session's **exclusive** hold on a task (proposal §4.2, LAI-541) — the
third of the three facts D-114 item 7 keeps apart: `assignee_id` is who is
accountable, `selected_agent_id` who the work is asked of, and the live claim is
**which running session holds it now**.

| field | notes |
| --- | --- |
| `id` | ULID |
| `task_id` | FK `tasks`, cascade |
| `session_id` | FK `agent_sessions` (§4.65), cascade |
| `agent_id` | FK `agents` (§4.63), cascade — the session's agent, kept on the row so the fence asks one table |
| `generation` | a per-task number, ≥ 1, that **only goes up**: each new claim on a task takes the next one. `(task_id, generation)` is unique |
| `lease_expires_at` | server time. Set to *now + the claim expiry* (§9.1) when the claim is taken and on every renewal |
| `state` | `active` \| `paused` \| `released` \| `expired` \| `transferred` (CHECK). `active` and `paused` are **live**; the other three are terminal |
| `created_at` | |
| `ended_at` | nullable — when it stopped being live |

Indexes: a **partial unique index on `(task_id)` where `state IN ('active',
'paused')` — one live claim per task**, which is the lock; `(task_id,
generation)` unique; `(session_id)`, `(agent_id)`, `(state, lease_expires_at)`
for the expiry scan.

**How a claim ends.** `released` — the task left `in_progress` (the holder's
`finish_task`, a person's move) or the session ended; `expired` — the lease
lapsed and the expiry scan (§11.6), or a heartbeat that arrived too late, marked
it, writing `task.claim_expired`; `paused` and `transferred` are the hand-off's
(§4.73, LAI-546): offering pauses the holder's claim, a decline, cancel or
offer expiry resumes it, and an accept marks it `transferred` beside the
receiver's new claim at the next generation. **A `paused` claim is live and
leased exactly like an `active` one**: heartbeats renew it, and a lapsed lease
expires it by the same scan or late heartbeat, writing the same row — a paused
claim never outlives its process. **An accepted recovery leaves the expired
claim `expired`**; `transferred` is only ever a paused sender's, at its own
offer's accept. **Nothing moves a claim out of
`expired`**: reclaiming inserts a new row at the next generation (§5, §9.1).
Rows are never deleted; they are the task's claim history.

### 4.67 `recognised_agent_devices`

The owner's confirmed device labels (LAI-590). No row means unrecognised.
Labels group agents; they are not device identities or fingerprints.

| field | notes |
| --- | --- |
| `owner_user_id` | FK `users`, cascade — with the label key, the primary key |
| `label_key` | normalised as §4.63; empty string for null/blank labels |
| `created_at` | first confirmed; upgrade uses the oldest agent registration on that label |

Primary key `(owner_user_id, label_key)`. Confirmation is idempotent and
requires an existing device among the caller's own agents. A confirmation
persists if agents move away or are revoked; moving an agent to another label
does not confirm that label. No retention beyond the owner and no activity
verb: these rows record the statement, as agent registration does (§4.63).

### 4.68 `project_context_revisions`

Every revision of a project's context document (§7.3, proposal §4.6, LAI-555).
**Immutable**: triggers refuse `UPDATE`, any insert that lands on an existing
row by **either** unique key — its `id`, or its `(project_id, revision)` — so
`INSERT OR REPLACE` cannot replace a revision whichever key it collides on, and
`DELETE` while the project exists. Boot refuses to start without them, or with
a definition that differs from the one it creates, as §4.49's. The newest row's `body` is `projects.context_md` and
its `revision` is `projects.context_revision` (§4.3).

| field | notes |
| --- | --- |
| `id` | ULID |
| `project_id` | FK `projects`, cascade |
| `revision` | integer ≥ 1 (CHECK); `(project_id, revision)` unique — two writers that read the same revision cannot both make the next |
| `body` | the whole document at this revision |
| `author_id` | nullable, **a copy, no FK** — the person who wrote it; null on a revision 1 migrated from a document no edit was recorded for |
| `agent_id` | nullable, **a copy, no FK** — the registered agent whose token wrote it (§4.63), or null |
| `created_at` | |

**Migration 0066** makes each project's non-empty `context_md` its revision 1,
authored by whoever last edited it per `activity` (null if nobody is
recorded), at that edit's time or the project's `updated_at`, and sets
`context_revision` to 1. `context_md` is left as it was, so a rollback keeps
the document. **No new §4.8 verb**: each write already writes
`project.context_updated`, whose payload now carries `revision`.

### 4.69 `agent_session_context_deliveries`

The context revision Laika last **delivered** to an agent session, per
project (proposal §4.6, LAI-555). Delivered means the server sent that
revision — the whole document or a diff ending at it — in answer to a call
that named the session (`get_project_context`'s `session_id`, §7.1). **It
never means the agent read, understood or acted on it**, and nothing shown
from it may say so (LAI-556: *received*).

| field | notes |
| --- | --- |
| `session_id` | FK `agent_sessions` (§4.65), cascade — with `project_id`, the primary key |
| `project_id` | FK `projects`, cascade |
| `revision` | the revision delivered. Only moves forward: a slower call that delivered an older one does not undo a newer delivery |
| `delivered_at` | |

Index `(project_id)`. Only the calling agent's **own open** session is
recorded against: another agent's is `404`, an ended one `409`, as a
heartbeat answers (§9.1). No activity row: a delivery is presence, as a
session is.

### 4.70 `task_checkpoints`

A save an agent registers **on purpose** inside a task its session holds
(proposal §4.3, D-115) — not a heartbeat, and not telemetry: D-005 stands
unchanged. It is what a receiver continues from (§4.73). Proved only by signed
push deliveries (§4.71, §4.72, §10.1, D-116, D-116a); **the server never
fetches a URL and never calls GitHub** (D-083).

| field | notes |
| --- | --- |
| `id` | ULID, **minted by the helper** before its push (§6.4) — also the last segment of its tag, `laika-ckpt/<LAI-NNN>/<id>` |
| `task_id` | FK `tasks`, cascade |
| `session_id` | FK `agent_sessions` (§4.65), `restrict` — the session that saved it, which held the task's live claim when it did |
| `claim_generation` | that claim's generation (§4.66). A save under any other generation is refused by the fence (§6.3) before it is written |
| `repo` | the repository, `owner/name` — **must be the project's configured repo** (§4.3 `repo`); any other is `422 unprocessable`, `reason: repo_not_configured` |
| `branch` | the work branch the helper pushed, `LAI-NNN-…` (§9.2) |
| `remote_ref` | the checkpoint's **first** tag, `refs/tags/laika-ckpt/<LAI-NNN>/<id>` — a lightweight tag at `commit_sha`, pushed alone (D-116 item 1). A re-tag's ref is a §4.71 row; this column never changes |
| `commit_sha` | the full 40-character commit SHA the save is |
| `manifest` | JSON — the files changed, each `{ path, added, removed }` (line counts), at most 1000 entries. **Names only**: no field holds file contents, a diff, a prompt or a transcript (D-115 item 4) |
| `summary` | nullable — JSON, the structured continuation note: `{ work_done, next_step, decisions, open_questions, failing }`, each a string of at most 4000 characters (`failing` names known failing tests or builds; D-115 item 8). Free text and therefore **the risk** (D-115 item 5): the helper refuses a note that matches its secret patterns, which is a mitigation, not a guarantee. Shown only to people who can read the task, as data, never as instructions (item 7) |
| `summary_commit_sha` | nullable — the commit the note describes; null exactly when `summary` is |
| `context_revision` | nullable — the project brief's revision the session had seen (proposal §4.6); written by nothing until Phase 4 |
| `created_at` | |
| `verified_at` | nullable — when `verification` last became `verified`; null otherwise |
| `verification` | `pending` \| `verified` \| `ref_deleted` \| `uncertain` (CHECK) — **the state of the checkpoint's newest ref** (§4.71), copied here in the transaction that changes it, so a reader asks one table |
| `idempotency_key` | unique — the helper's key; registering the same key again answers the row already written (D-116 item 1: push, then register, and retry a failed registration with the same key) |

Indexes: `(task_id, created_at)`, `(session_id)`, `idempotency_key` unique.

**The saved fields are never changed.** `verification` and `verified_at` move
in exactly two ways: a **delivery** for the checkpoint's newest ref (§10.1),
and **registering a ref** — the first tag at the checkpoint's registration,
or a re-tag (§4.71) — which makes the new ref the newest and sets
`verification` to that ref's state as derived at that moment: `pending` unless
its deliveries arrived first. **Registering a ref is the one change not caused
by a delivery.** It cannot establish `verified` without signed delivery
evidence: it projects the state from the §4.72 deliveries already stored for
that `repo` + `ref`, which is `verified` only when a delivery that arrived
before the registration says so, and `pending` when none has. Never from what
an agent says (D-116 item 3). **`verification` is
D-116's set, not the proposal's**: proposal §4.3 named `missing`, which D-116
does not have — a checkpoint whose notice never came is `pending`, labelled
after ten minutes (below). **`superseded` is not stored**: a reader derives
it — a newer `verified` checkpoint on the same claim exists — and shows it as
information only. **`pending_since`** (§6.4) is the newest ref's `created_at`
while `verification` is `pending`, so a re-tag restarts the pending timer.

**What the UI says** (D-116 item 6, D-115 item 6):

- `pending`: **"Verification pending"**
- `pending`, older than the pending notice (§9.1.1, 10 min): **"Verification pending — no push notice from GitHub yet"**, shown to owners and admins too, with the pointer to the webhook's *Recent Deliveries* and *Redeliver*
- `uncertain`: **"Save needs attention — GitHub's notices do not match a single clean save"**
- `ref_deleted`: **"Save removed from GitHub"**
- `summary` null: **"No continuation note"**
- `summary_commit_sha` ≠ `commit_sha`: **"Note describes an earlier save"** (stale)

**A `pending` or `uncertain` checkpoint can be neither offered nor accepted**
(D-116 item 6), and nor can a `ref_deleted` one: an offer naming one is `409
conflict`, `reason: checkpoint_unverified`, and so is an accept whose
checkpoint is no longer `verified` when the accept runs. **Failing tests do
not invalidate a save** (D-115 item 8); its `failing` is shown as written.

**Retention** (D-115 item 9): a server job (§11.6) deletes checkpoint rows —
with their §4.71 rows and the §4.72 rows for those refs — **90 days** after
their task reaches `done` or `cancelled`. Closed offers that named one keep
their own snapshot (§4.73 `checkpoint_commit_sha`, `note_hash`) and lose the
link (`ON DELETE SET NULL`); a task that is `done` or `cancelled` has no live
offer (§4.73 `task_closed`), so nothing live is ever detached. Append-only
`activity` rows that name a checkpoint keep its id and SHA. **Laika never
deletes a Git tag**; `laika agent checkpoints prune --dry-run` lists the tags
past retention and deletes nothing (D-116 item 2).

**Automatic saves need consent** (D-115 item 2): a hook may save without asking
only for an agent whose owner consented at setup, recorded in §4.75. Manual
saves need no consent.

### 4.71 `checkpoint_refs`

Every Git ref a checkpoint has (D-116 items 4 and 7): its first tag, and each
re-tag `laika-ckpt/<LAI-NNN>/<checkpoint-id>-r<n>` pushed by `laika agent
checkpoint reverify`. **Each ref is judged on its own; a checkpoint's state is
its newest ref's**, and the receiver fetches that ref.

| field | notes |
| --- | --- |
| `id` | ULID |
| `checkpoint_id` | FK `task_checkpoints`, cascade |
| `revision` | `0` for the first tag, `n` for `-r<n>`. `(checkpoint_id, revision)` is unique; the newest is the highest |
| `repo` | the checkpoint's `repo` — with `ref`, the name §4.72's deliveries are matched by |
| `ref` | the full ref, `refs/tags/laika-ckpt/<LAI-NNN>/<checkpoint-id>` or `…-r<n>`. `(repo, ref)` is unique |
| `state` | `pending` \| `verified` \| `ref_deleted` \| `uncertain` (CHECK), derived from the §4.72 rows for `(repo, ref)` by the rule below and **never from their arrival order** |
| `created_at` | when it was registered — the start of its pending timer |

**The rule** (D-116 item 4 as clarified by **D-116a**) — a function of the
**set** of transitions seen for `(repo, ref)`, the all-zero SHA meaning
"absent", whatever order they arrived in:

- None → `pending`
- Exactly one creation `0000…→commit_sha`, and nothing else → `verified`
- That one creation, plus one or more deletions `commit_sha→0000…`, and
  nothing else → `ref_deleted`
- Anything else — a second creation, an update, a ref at a different SHA, a
  deletion with no creation seen, an annotated tag's object SHA → `uncertain`

**Neither `ref_deleted` nor `uncertain` ever becomes `verified` again** — that
is what *final* means (D-116a): no transition can be removed from the set, and
every set containing a deletion or a foreign transition maps to one of those
two. Between them the set decides: a deletion seen before its creation reads
`uncertain` until the creation arrives, then `ref_deleted`; a `ref_deleted`
ref that later sees a foreign transition becomes `uncertain`. Only a re-tag —
a **new** ref, starting from absent — gives the checkpoint a way back.

**Registering a re-tag** (`POST /checkpoints/:id/refs`, §6.4) happens before
its push. It inserts the next `revision` and, **in the same transaction**,
derives the new ref's state from whatever §4.72 already holds for its name
(normally nothing, so `pending`) and copies it to `task_checkpoints.
verification` — the non-delivery change §4.70 names.

### 4.72 `checkpoint_ref_transitions`

One row per signed `push` delivery that moved a `laika-ckpt/` ref in the
project's configured repo (D-116 items 4 and 5). Append-only. **Keyed by the
ref's name, not by a §4.71 row**, so a delivery that arrives before its
checkpoint is registered is stored durably and counted the moment the ref is
registered (push, then register — the helper's order, D-116 item 1 — makes
that the normal race, not an edge case).

| field | notes |
| --- | --- |
| `id` | ULID |
| `repo` | the delivery's repository, `owner/name` |
| `ref` | the delivery's `ref`, in full |
| `delivery_id` | unique — the delivery's `X-GitHub-Delivery`. **Written in the same transaction** that stores the transition and re-derives the state of a registered ref of that name, so a delivery that was applied is ignored when it repeats, and one that failed before it was applied leaves no row and is processed when redelivered (redeliveries reuse the id) |
| `before_sha` | the delivery's `before`, 40 characters; all zeros means the ref was absent |
| `after_sha` | the delivery's `after`; all zeros means the ref was deleted |
| `created_at` | when Laika stored it — **receipt time, which decides nothing** |

Indexes: `delivery_id` unique, `(repo, ref)`.

**Applying a delivery** is one `BEGIN IMMEDIATE` transaction, and deliveries
for one `(repo, ref)` are applied one at a time: insert the row; if a §4.71 ref
of that name is registered, re-derive its `state` from every row for the name
and, when it is its checkpoint's newest ref, copy the state to
`task_checkpoints.verification` (and `verified_at` on `verified`).
**Registering a ref** reads the same rows in its own transaction, so whichever
of the two commits second sees the other.

**Retention.** Rows for a registered ref go with its checkpoint (§4.70).
Rows for a name **never registered** — a tag pushed by hand, or a helper that
pushed and never registered — are deleted 90 days after `created_at` (§11.6).

### 4.73 `handoff_offers`

Work offered to an agent (proposal §4.4, D-114 item 7). Three kinds:
a **work request** (§4.5 `selected_agent_id`: selecting an agent opens one;
LAI-535), a **hand-off** (the session holding the live claim offers the task
on), and a **recovery** (the system offers a task whose claim expired; §3.4).
**An orphan is offered, never assigned.**

| field | notes |
| --- | --- |
| `id` | ULID |
| `task_id` | FK `tasks`, cascade |
| `kind` | `work_request` \| `handoff` \| `recovery` (CHECK) |
| `idempotency_key` | nullable, unique where set — the sender's key; repeating it answers the offer already made (§6.4). Null for a work request and a recovery, which the server makes |
| `from_session_id` | nullable FK `agent_sessions`, `restrict` — the sending session, which held the live claim. Null for a work request and a recovery |
| `from_claim_generation` | nullable — the generation of the claim the offer moves on from: the sender's live claim for a hand-off, the expired claim for a recovery. Null for a work request |
| `to_agent_id` | nullable FK `agents`, cascade — the agent offered to. **Null means any eligible agent**, which only a recovery uses; a work request and a hand-off always name one, and an approval names one (below) |
| `checkpoint_id` | nullable FK `task_checkpoints`, **`ON DELETE SET NULL`** — what the receiver continues from. **Required for a hand-off and a recovery** when the offer is made, and then a `verified` checkpoint **of this task**: for a hand-off, saved under the sender's **live** claim generation; for a recovery, the task's latest verified one. Null for a work request, and after retention removed the checkpoint of a closed offer (§4.70) |
| `checkpoint_commit_sha` | nullable — the checkpoint's `commit_sha`, copied when the offer is made and never changed, so a closed offer still says what it carried after its checkpoint is gone. Null for a work request |
| `reason` | nullable — the sender's reason, at most 500 characters; required for a hand-off. Untrusted data (D-115 item 7) |
| `note_hash` | nullable — SHA-256 of the checkpoint's `summary` as offered, so the receiver sees whether the note it reads is the note that was offered |
| `requires_approval` | boolean — for a named receiver, fixed when the offer is made or the receiver is named: the receiving agent's owner is not the owner of the agent the work moves from (the sender's, or for a recovery the expired claim's) and the policy (§4.74) says `cross_owner_requires_approval` |
| `approved_by_user_id` | nullable FK `users` — who approved: **the task's assignee or a project lead, and never the owner of the receiving agent** (§3.2) |
| `approved_at` | nullable — both or neither with `approved_by_user_id` (CHECK) |
| `state` | `pending_approval` \| `open` \| `accepted` \| `declined` \| `cancelled` \| `expired` (CHECK). An offer needing approval starts `pending_approval`; every other starts `open`. `pending_approval` and `open` are **live** |
| `expires_at` | nullable — *now + the policy's `offer_ttl_minutes`* for a hand-off and a recovery; null for a work request, which never expires |
| `accepted_session_id` | nullable FK `agent_sessions`, `restrict` — the receiver's session, set on `accepted` |
| `accepted_claim_id` | nullable FK `task_claims` (§4.66), `restrict` — **the claim the accept created**, so the claim history names the offer it came from |
| `receiver_commit_sha` | nullable — the `verified_commit_sha` the receiver sent with its accept (D-116 item 8): **the receiver's acknowledgement, not proof**. The UI labels it *"Receiver confirmed commit …"* |
| `closed_reason` | nullable — why a live offer closed other than by its receiver or the clock: `withdrawn` (the sender or a person cancelled it), `reclaimed` (the old holder reclaimed, §9.1.1), `selection_changed` (a work request's selection was cleared or changed), `task_closed` (the task left `in_progress`), `agent_revoked` |
| `created_by_user_id` | FK `users`, cascade — the person behind it: the selector of a work request, the owner of the sending agent for a hand-off, the task's assignee for a recovery (or the project's first lead when it has none) |
| `created_at` | |
| `closed_at` | nullable — when it left a live state |

Indexes: `(task_id)`, `(to_agent_id, state)`, `(created_by_user_id)`; a
**partial unique index on `(task_id)` where `kind = 'work_request' AND state =
'open'`** (LAI-535), and one on `(task_id)` where `kind IN ('handoff',
'recovery') AND state IN ('pending_approval', 'open')` — **one live hand-off
or recovery per task**.

**Beyond proposal §4.4**, each for a named reason: `receiver_commit_sha` is
D-116 item 8's record; `from_claim_generation` scopes the reclaim's refusal
(§9.1.1); `accepted_claim_id` links a recovery's new claim to its offer;
`checkpoint_commit_sha` survives retention; `closed_reason` is where proposal
§4.2's *"cancels … with reason `reclaimed`"* is kept; `created_by_user_id` and
`closed_at` are LAI-535's, already built.

**Every write is one `BEGIN IMMEDIATE` transaction** that reads everything
again from the database — the owner's permission, the agent's status and
grant, the token's scope, the policy, the offer's state and expiry, the
checkpoint's `verification`:

- **Offer.** Only the session holding the task's **live, `active`** claim may
  offer it. Offering **pauses** that claim (§4.66 `paused`): it keeps renewing
  like an active claim, and any change it makes to the task is `409 conflict`,
  `reason: claim_paused`. A hand-off needs a `reason` and a `verified`
  checkpoint of this task saved under the live generation — another task's,
  or an older generation's, is `422`, `reason: checkpoint_not_this_claim`. An
  agent that may not receive (below) is `422`, `reason:
  receiver_not_eligible`. **A retry with the same `idempotency_key` and the
  same body** answers the existing offer `200`; it is matched after the
  caller's own checks — token, agent status and grant, `task.handoff.offer` —
  and **before** the claim fence, which the first attempt has just paused.
  The same key with a different body is `409 conflict` (§6.3).
- **Who may receive.** By default only **the same owner's** agents. A project
  whose policy has `allow_other_owners` opens it to other members' registered
  agents with a `full` grant on the project; a transfer to a different owner
  then waits in `pending_approval` when `cross_owner_requires_approval` is on.
- **Approve.** A person, signed in: **the task's assignee or a project lead
  (an org Owner or Admin is an implicit lead), and never the owner of the
  receiving agent** — `403 forbidden`, `reason: approver_is_receiver`. When the
  assignee owns the receiving agent, a lead approves. Moves the offer to
  `open`. **An unnamed recovery** (`to_agent_id` null) is accepted without
  approval by an agent of the expired claim's owner, and — where the policy
  allows other owners and `cross_owner_requires_approval` is off — by an
  eligible agent of another owner. Where `cross_owner_requires_approval` is
  on, another owner's agent needs a person to **name and approve it in one
  step** — approve with `to_agent_id`, which sets the receiver and is refused
  for an agent the approver owns, as above; that agent accepting it unnamed is
  `409`, `reason: approval_pending`.
- **Accept.** The receiving agent's session, with `verified_commit_sha`. The
  server checks again: permission, approval, expiry, the policy's
  `max_handoffs` against `tasks.handoff_count`, and that the checkpoint is
  **still `verified`**. A SHA that differs from the checkpoint's is `422
  unprocessable`, `reason: checkpoint_mismatch`. Then, in the same
  transaction:
  - **the claim the work moves from ends.** A hand-off's sender claim, still
    `paused`, becomes `transferred`. A recovery's expired claim **stays
    `expired`** — terminal, never rewritten — and so does a hand-off sender's
    claim that lapsed while its offer was live;
  - a **new claim** is inserted for the receiver's session at the task's
    newest generation + 1, and `accepted_claim_id` names it;
  - **`tasks.selected_agent_id` becomes the receiving agent** (D-119: the
    selected agent owns the claim, so the receiver's claim must be backed by
    the selection, or §6.4's unbacked-claim rule would release it); one
    `task.agent_selected` row records it, and an open work request for the
    old selection closes `selection_changed`;
  - `tasks.handoff_count` goes up by one (a work request does not count);
  - the offer becomes `accepted`, and `task.handoff_accepted` is appended.

  **Two receivers: the first commit wins**, the second is `409 conflict`,
  `reason: offer_taken`. Accepting never moves `assignee_id` — changing the
  human assignee is a separate, explicit act (D-114 item 7).
- **Decline or cancel.** The receiver declines; the sender — or the task's
  assignee or a project lead — cancels. **Either resumes the sender's claim if
  it is still `paused`** (`paused` → `active`); a claim that lapsed meanwhile
  stays `expired`, and the task then gets a recovery offer as any expiry does
  (§11.6). Declining an unnamed recovery is not possible — an agent that does
  not want it simply does not accept.
- **Expire.** §11.6's scan moves a live offer past `expires_at` to `expired`
  and resumes a still-`paused` claim, as the system (§3.4). An expired
  recovery is followed by a fresh one while the task's newest claim is still
  expired, it has a verified checkpoint and nobody reclaimed.
- **No verified checkpoint.** A task whose claim expired with no `verified`
  checkpoint gets **no** recovery offer: it shows *"Automatic recovery
  unavailable — no saved checkpoint"*, and a person reassigns it or releases
  it to the backlog. Automatic recovery uses the **latest verified**
  checkpoint and shows any newer one beside it as unverified (D-116 item 6).
- **A revoked agent** cannot offer, accept, decline or renew (`403`, `reason:
  agent_revoked`); revoking one closes its live offers `agent_revoked`.
- **What fencing cannot do.** It protects Laika's state. It cannot stop a
  disconnected process from editing its own files or pushing with its own Git
  credentials; that is contained by one branch per run and by Review.

### 4.74 `project_handoff_policies`

A project's hand-off settings (proposal §4.5), edited on the space settings'
Access tab by a lead. **No row means the defaults.** It governs who may be
selected, offered work or accept a transfer, and **never narrows a read or a
comment** (D-114 item 3).

| field | notes |
| --- | --- |
| `id` | ULID |
| `project_id` | FK `projects`, cascade, unique — one policy per project |
| `allow_other_owners` | boolean, default `false` — may another member's registered agent receive a hand-off or recovery here |
| `cross_owner_requires_approval` | boolean, default `true` — does a transfer to a different owner wait for an approver |
| `max_handoffs` | integer 0–20, default `3` — completed hand-offs per task (`tasks.handoff_count`); an accept past it is `409 conflict`, `reason: handoff_limit` |
| `offer_ttl_minutes` | integer 5–1440, default `30` — how long a hand-off or recovery offer stays live |
| `updated_by` | nullable FK `users` — who last changed it |

Editing it writes `project.updated` with `{ field: 'handoff_policy', from, to
}`: a settings change, as every other project setting is.

### 4.75 `agent_checkpoint_consents`

The owner's consent to **automatic** checkpoints for one agent (D-115 item 2):
given once at setup, after which hooks save after tool activity or at a session
boundary without asking each time. Manual checkpoints never need it.
Given, read and withdrawn through `/agents/:id/checkpoint-consent` (§6.4).

| field | notes |
| --- | --- |
| `id` | ULID |
| `agent_id` | FK `agents` (§4.63), cascade, unique — one consent per agent |
| `given_by_user_id` | FK `users` — who consented: the agent's owner, signed in |
| `given_at` | |
| `withdrawn_at` | nullable — set when the owner withdraws it; automatic saves stop, manual ones keep working. Giving it again clears this and stamps `given_at` afresh |

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
  API-level twin of the file-move lock the build sessions use by hand. The
  holder's own claim of a task already in progress is not a second claim: it
  changes nothing but the branch it is given (§7.1, LAI-770).
- **A registered agent's claim is exclusive and fenced** (proposal §4.2,
  LAI-541). Its `start_working` also takes the task's one live claim (§4.66)
  for its session, at the next `generation`, with a lease. **An agent's claim
  never writes `assignee_id`** (D-114 item 7: changing the assignee is always a
  separate, explicit act): an unassigned task **stays unassigned** — the claim
  is the lock, not the assignee — a task its owner holds stays theirs, and a
  task held by **someone else** may be claimed only when an open work request
  asks this agent for it (§4.5), and stays theirs. Claiming answers that work
  request, `open` → `accepted`, and assigns nobody. A claim that moves the task
  to `in_progress` writes `task.status_changed` with `via: "claim"` and
  `claim_generation`, and **no `assignee_id`**; a claim on a task already in
  progress writes `task.updated` with `field: "claim"`. For §5's review rule
  below, on a task **nobody is assigned to**, the agent holding the live claim
  answers as the assignee would, so it can finish it into review; on a task
  **another person is assigned to**, the rule is asked of the agent's owner,
  and an agent is never more than its owner (D-114).

  | claim state | live? | how it is reached | the task |
  | --- | --- | --- | --- |
  | `active` | yes | `start_working`, or the explicit reclaim | `in_progress` |
  | `paused` | yes | a hand-off is open (LAI-546) | `in_progress` |
  | `released` | no | the task left `in_progress`, or the session ended | any |
  | `expired` | no | the lease lapsed (§9.1) | stays `in_progress` — **never reassigned silently** |
  | `transferred` | no | a hand-off was accepted (LAI-546) | `in_progress`, under the receiver's claim |

  **Leaving `in_progress` releases the live claim** — the holder's `finish_task`
  into review, a person's move — and its generation is refused from then on.
  A task whose newest claim **lapsed** — `expired` or `transferred` — while it
  stayed in progress is held by that lapse: it can be claimed again only by the
  explicit reclaim of the agent that held it, **every token's change to it is
  refused** (§6.3) — the old holder `stale_claim` with or without a
  generation, anyone else `claim_held` — and only a person moving it out of
  progress ends that state. The reclaim takes back a task **still in
  progress** only.
- Moving to `review` requires the assignee, a project `lead`, or org Admin/Owner.
  On an unassigned task, the agent holding its live claim answers as the
  assignee; on an assigned one, the rule is asked of the agent's owner (LAI-541).

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
- **An agent never moves a task into `done`** (D-082, LAI-758). A caller
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

**A password-reset link is a third way to a password, not a third credential**
(D-104 item 4, LAI-983). An admin issues it (`POST /users/:id/reset-link`,
§3.1, session only); `POST /password-resets/consume` is public and the token
is its whole authority, as an invite's is. It sets the password through
better-auth's own hasher and **ends every session of that person**. Refused
links back off by the rule above, on their own counter: keyed on the account
the link belongs to, and on one shared key for a link that matches nothing,
so a `429` never says which links exist. A malformed body or a too-short
password is not an attempt.

### 6.2 Authorisation

Handler resolves `Actor` → loads the resource → `assertCan(...)` → 403 if false.
Token scope narrows afterwards: `read_only` permits every `GET` the user's role
allows and nothing else; `project_ids_json`, when set, restricts the token to
those projects. A Viewer's token can never write, whatever its scope says.

**A token pinned to projects is refused org-wide admin actions** (audit H4).
When `project_ids_json` is set, the token keeps only the org-level reads every
member has and its own-record actions (its own tokens, heartbeats, unlisted
work, activity sharing, time settings and drafts); every other org-scoped
action — settings, projects, invites, members, other people's tokens,
org-wide history and usage — is refused, whatever the user's role. The pin
narrows, exactly as §3.3 says a token only ever can; a project-scoped
credential is not an org credential with a project filter.

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
  only*; `project_pinned` when a token pinned to projects is refused an
  org-wide action it does not keep (§6.2, H4); `local_activity_off`, `day_out_of_range` and `invalid_tz` on a local
  activity report (§6.4); `token_required` on a heartbeat (§9.1);
  `protobuf_not_supported` and `otlp_invalid` on OpenTelemetry metrics
  (LAI-773); the claim fence's (below); and the hand-off's (below). The status
  and `code` stay the vocabulary above, so a client that branches on `code`
  keeps working, and one that needs the reason has it.
- **The claim fence** (proposal §4.2, §4.66, LAI-541). A registered agent's
  change to a task carries the generation of the claim its session holds:
  REST's request header **`X-Laika-Claim-Generation`** (a positive integer;
  anything else is `400 bad_request`), MCP's `claim_generation` argument (§7.2).
  The check is in the shared task service, so both transports answer alike.
  Every refusal is **`409 conflict`** — D-079: a finer reason never becomes a
  code — with `details.reason` one of:

  | `reason` | when |
  | --- | --- |
  | `stale_claim` | the generation is not the task's live claim's — older, newer, released or **expired** — or the live claim's lease has lapsed, or the holder's own agent sent none; the caller's own claim on the task **lapsed**, whether or not it sent a generation; a generation sent where no claim is live; also a session that has ended. `details.reclaim: true` when the caller's own claim expired and the explicit reclaim is the way back |
  | `claim_held` | another session holds the live claim — **another agent of the same person included**, which is fenced exactly as another person's is — or a token with no agent (a legacy token) tried to change or claim a task a registered agent's session holds (D-114 item 6), or the task's claim lapsed and is waiting for recovery (any token but the old holder's) |
  | `claim_paused` | the live claim is paused while its holder's hand-off offer is live (§4.73, LAI-546): the lease keeps renewing, and every change the holder makes is refused until the offer is declined, cancelled or expires |
  | `selected_for_another_agent` | **D-119** (LAI-586): the task has a selected agent (§4.5) and the caller is a session of a different agent — *"once a task names its agent, only that agent can start it."* Answered by a claim (`POST /tasks/:id/claim`, `start_working`) — **the holder's own session renewing included** — and a reclaim; asked after the caller's own `task.claim`, and `details` names the selected agent (`selected_agent_id`, `selected_agent: { id, display_name, harness, device_label }`) only when the caller may read the task's project; `display_name` is the agent's owner's alone and `null` for anyone else (D-120), and the message names the agent as `harness · device`. Also the fence's answer to any change made under a live claim the selection does not back (a claim taken before D-119, or before the selection) |

  **The rule, in order.** (1) The system (§3.4) and **a person signed in** are
  never fenced — people keep explicit control, and their change is recorded
  as theirs (§4.8). (2) A task with a **live** claim: only its holder's agent,
  with the live generation and an unlapsed lease. (3) A task whose newest
  claim **lapsed** while it stayed in progress: no token at all — **omitting
  the generation is not a way round it**. (4) A task nobody holds: a token
  may change it without a generation. **Reads and comments are never fenced**,
  for anyone.

  **Indirect changes count.** A change that reaches a claimed task without
  naming it passes the same fence for every task it would touch, before any
  is touched: deleting a sprint (its tasks' `sprint_id`), deleting a status
  (its tasks move), renaming or deleting a tag (its tasks' tags), removing or
  deactivating a member with `open_tasks` (their tasks' assignee). A presence
  heartbeat's branch write (§9.1) **passes the same fence** — the holder sends
  its generation in `X-Laika-Claim-Generation` as on any request — and where
  the fence refuses, the beat still lands (`202`) and the task is untouched.
- **Checkpoints and hand-offs** (§4.70 – §4.74, D-116, LAI-544). Their
  refusals use the vocabulary above with `details.reason` — D-079, as the
  fence's do. Saving and offering pass the claim fence first.

  | status · code | `reason` | when |
  | --- | --- | --- |
  | `409 conflict` | `offer_taken` | another receiver accepted first; or a reclaim found a hand-off or recovery offer accepted **from the generation it reclaims** (§9.1.1) |
  | `409 conflict` | `offer_closed` | the offer is no longer live — accepted, declined, cancelled or expired. `details.state` says which |
  | `409 conflict` | `approval_pending` | an accept on an offer still `pending_approval`, or on an unnamed recovery by an agent of another owner where approval is required (§4.73) |
  | `409 conflict` | `checkpoint_unverified` | the checkpoint named, or the offer's, is `pending`, `uncertain` or `ref_deleted` — **neither offered nor accepted** (D-116 item 6). `details.verification` says which |
  | `409 conflict` | `handoff_limit` | the task has `max_handoffs` completed hand-offs (§4.74) |
  | `409 conflict` | `offer_live` | an offer while the task already has a live hand-off or recovery offer |
  | `422 unprocessable` | `checkpoint_mismatch` | the accept's `verified_commit_sha` differs from the checkpoint's `commit_sha` (D-116 item 8) |
  | `422 unprocessable` | `repo_not_configured` | a checkpoint's `repo` is not the project's configured repo, or the project has none (D-116, limitation 4) |
  | `422 unprocessable` | `checkpoint_required` | a hand-off with no `checkpoint_id` |
  | `422 unprocessable` | `checkpoint_not_this_claim` | the checkpoint belongs to another task, or — for a hand-off — was saved under a generation other than the sender's live claim's |
  | `422 unprocessable` | `receiver_not_eligible` | the named agent is revoked, has no `full` grant on the project, or has a different owner where the policy does not allow it |
  | `403 forbidden` | `approver_is_receiver` | the approver owns the receiving agent |
  | `403 forbidden` | `not_an_agent` | a session or a legacy token saving, offering, accepting or declining |
  | `403 forbidden` | `agent_revoked` | a revoked agent's offer, accept, decline or save |
  | `403 forbidden` | `not_the_receiver` | an accept or decline of a **named** offer by any agent but the one it names (§4.73). An unnamed recovery has no such refusal: an ineligible agent's accept is `422 receiver_not_eligible`, and any decline is `422 recovery_unnamed` |
  | `403 forbidden` | `user_inactive` | a person deactivated after the request was resolved: approve, cancel and the policy read the person again inside their transaction (§4.73) |
  | `422 unprocessable` | `recovery_unnamed` | a decline of an unnamed recovery — an agent that does not want it does not accept it (§4.73) |
  | `422 unprocessable` | `work_request` | an approve, accept, decline or cancel naming a work request: it is accepted by claiming the task and withdrawn by changing its agent (§4.5) |
  | `429 rate_limited` | `handoff_rate` | the agent's hand-off bucket is spent — making, accepting, declining or cancelling an offer (§6.3 *Rate limits*); with `Retry-After` |

  A `422` on a field also carries `field`, as every validation refusal does.
- **Idempotency**: `POST` accepts `Idempotency-Key`. Only these create routes
  keep a response: `POST /projects`, `/projects/:slug/tasks`,
  `/projects/:slug/sprints`, `/tasks/:id/comments`, `/tasks/:id/dependencies`,
  `/agent-sessions`. Before a replay, the route's own permission is asked again
  of the caller as they are now — for dependencies including the claim fence —
  and if refused the route runs instead. A token replays only its own answers,
  and an answer carrying a one-time secret is never stored. Same key with a
  different body is `conflict`. **One route keeps its own key** (LAI-746):
  `POST /users/:id/ratings`, which is session-only (§3.1). Requests made with a
  token are keyed by that token, so one credential never replays another's
  answer; requests made with a browser session are keyed by the user. The shared
  store answers before the route runs and keeps the response body — which there
  is a private note — so that route stores the key on the rating and answers a
  retry from it after `can()`. Its keys are per rater and do not expire.
- **Rate limits**: in-process token bucket — 120 req/min per token, 600/min per
  session, 30/min for heartbeats, and for local-activity reports (`PUT
  /me/local-activity`, D-079) a bucket of **30, refilled one every 120
  seconds**: a burst of 30, then one every two minutes — up to 60 in a first
  hour, 30 an hour after — per token and per user for a session, on their own
  budget, snapshots, look-back reports and usage reports alike (D-080, D-084).
  OpenTelemetry metrics (`POST /otlp/v1/metrics`, LAI-773) have their own
  bucket, **12 a minute with a burst of 60**, per token and per user for a
  session — an exporter posts once a minute per running session.
  **Checkpoints and hand-offs have their own buckets** (proposal §4.4,
  LAI-545, LAI-546), per agent across its tokens, beside the general one:
  registering a checkpoint or a re-tag, **30 a burst, refilled one every 20
  seconds**; making, accepting, declining or cancelling an offer, **10 a
  burst, refilled one a minute**. Approving is a person's and shares the
  session's budget. A repeated idempotency key still spends a token.
  `429` with `Retry-After`, never below one second.

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
GET    /api/v1/me/activity-sharing           PUT .../activity-sharing  body { scope? }   (PUT session only; `enabled` → 403 organisation_controlled)
PUT    /api/v1/me/local-activity             a collector's report, look-back or usage report → { accepted_days }   (organisation's Developer insights on; 30/hour)
GET    /api/v1/me/local-activity             ?days=1–14 — what is held for the caller   DELETE → 204   (session only)
GET    /api/v1/me/token-alerts               the caller's own budget and runaway alerts   POST .../:id/dismiss → 204   (session only; LAI-773)
GET    /api/v1/me/plan-limit                 PUT .../plan-limit   DELETE → 204 — the developer's own forecast, an estimate   (session only; D-087)
POST   /api/v1/otlp/v1/metrics               OpenTelemetry metrics, OTLP/HTTP JSON, from the developer's own agents (organisation's Developer insights on; LAI-773)
GET    /api/v1/me/time-settings              PUT .../time-settings  body { draft_my_time } — the org's Time and the person's own switch   (PUT session only; LAI-787)
PUT    /api/v1/me/time-drafts                a collector's blocks, each with a work folder's chosen name and branch if sent → { accepted_days, stored_blocks }   (both time switches on; 30/hour)
POST   /api/v1/me/time-drafts                an agent's proposal → 201 { id, minutes, day } (both time switches on; twin of propose_time_entry)
DELETE /api/v1/me/time-drafts                every draft the caller has not confirmed → 204   (session only)
PATCH  /api/v1/me/time-drafts/:id            body { task?, project?, general?, minutes?, started_at?, ended_at?, folder?, branch? }   POST .../split { at }   POST .../dismiss → 204   (session only)
POST   /api/v1/me/time-drafts/:id/confirm    body { kind?, title?, description? }, optional → 201, the entry   POST /api/v1/me/time/days/:day/confirm  body { note? }, optional → { entries, day_note }   (session only)
PUT    /api/v1/me/time/days/:day/note        body { note } — the person's note on the day, null removes it → { day_note }   (session only; §4.62, LAI-501)
GET    /api/v1/me/time                       ?day=&tz= — My day: drafts, entries, breaks, agent minutes, drafts held, the week, the timer, the day's note   (session only)
GET    /api/v1/me/time/summary               ?from=&to= — Overview over a stretch of ≤ 92 days: totals, by day, by project, by task, by kind   (session only; LAI-526)
POST   /api/v1/me/time/timer                 body { tz, task?, kind?, title? } — start the person's one timer → 201   POST .../pause   POST .../resume   POST .../stop → 201 { entry, crossed_midnight }   DELETE → 204   (session only; §4.61, LAI-500)
POST   /api/v1/me/time/undo                  body { id } — the change an X-Undo-Id named, taken back → 204   (session only; LAI-831)
POST   /api/v1/me/time-breaks                body { day, tz, started_at, ended_at } — a gap waved away → 201   DELETE .../:id → 204   (session only; LAI-831)
POST   /api/v1/me/time-entries               body { day, tz, minutes, task?, project?, note?, kind?, title?, description?, started_at?, ended_at? } → 201   PATCH/DELETE .../:id   (session only)
GET    /api/v1/me/time-entries/:id/revisions an entry's append-only history   (session only)
PUT    /api/v1/org/time                      body { mode } — off | manual | drafts   (owner, admin; session only; LAI-787)
PUT    /api/v1/org/time/breaks               body { breaks } — the organisation's break schedule → the caller's time settings   (owner, admin; session only; LAI-955)
GET    /api/v1/me/time/solidtime             ?since= — what the person's CLI writes to Solidtime → { closed_through, push, held, projects, taken }   (session only; LAI-788)
PUT    /api/v1/me/time/solidtime/links       body { member_id, links } — what it wrote → { linked, removed, retired }   (session only)
PUT    /api/v1/me/time/solidtime/import      body { v, member_id, tz, from, to, complete, entries } → what changed   (session only)
GET    /api/v1/org/time/solidtime            the map, the people confirmed, and people not on Laika   (owner, admin; session only)
PUT    /api/v1/org/time/solidtime/projects   body { projects } → { projects }   PUT .../people body { people } → { people }   (owner, admin; session only)
PUT    /api/v1/org/time/solidtime/import     body { v, members, tz, from, to, complete, entries } → what changed, and not_on_laika   (owner, admin; session only)
GET    /api/v1/org                           PATCH /api/v1/org       (admin+; ai_api_key write-only; name 1–80 chars, trimmed — Change organisation settings, LAI-984)
                                             the owner's read adds extra_owners: [{ id, name, email }] — active owners besides orgs.owner_user_id, reported, never demoted silently (D-104 item 2)
                                             and owner_invites_pending: [{ id, email, expires_at }] — owner invites from before D-104 still unaccepted and unexpired, to revoke (LAI-982)
POST   /api/v1/org/transfer-ownership        body { user_id, confirm } — confirm is the target's email; target an active admin or member → { owner, previous_owner }; target becomes owner, caller admin, orgs.owner_user_id moves, one transaction; logged; only the owner orgs.owner_user_id names may — another owner from before D-104 is 403 reason not_recorded_owner   (owner only; session only; LAI-982)
POST   /api/v1/org/github-webhook            set or rotate the GitHub webhook secret; answers it once (session only)
DELETE /api/v1/org/github-webhook            clear it (204; session only)
GET    /api/v1/org/model-prices              PUT/DELETE .../model-prices/:model — API-equivalent prices (set: owner, admin; session only; LAI-773)
GET    /api/v1/org/overview                  people seen this week and open / in review / blocked / overdue counts over the spaces the caller can read → { people, tasks }   (viewer+; LAI-986)
GET    /api/v1/org/permissions               what each org role is granted → { roles, capabilities, grants, owner_locked, updated_at, updated_by }   (viewer+; LAI-958)
PUT    /api/v1/org/permissions               body { grants: { admin|member|viewer: { <capability>: bool } } } — the whole matrix, every role and capability; same answer   (owner only; session only)
GET    /api/v1/users                         ?limit=&cursor=&updated_since=&include_inactive=
                                             cursor is (name, id) — a directory reads alphabetically
                                             each user carries last_seen_at: their latest session activity, or null (LAI-981)
PATCH  /api/v1/users/:id                     (role: owner only; deactivate: owner, and admin by default — LAI-958)
                                             org_role 'owner' → 422 reason use_transfer; so is demoting or deactivating the owner orgs.owner_user_id names (LAI-982)
                                             deactivating takes open_tasks: "unassign" | { reassign_to } — 409 without it while they hold open tasks (LAI-986)
                                             deactivating revokes every token and ends every session; reactivating restores neither (D-104 item 3)
POST   /api/v1/users/:id/reset-link          → 201 { url, expires_at } — a one-time password-reset link, shown once, ≤ 24 h; revokes their earlier unused links; recorded in §4.60   (owner, and admin by default; never for the owner unless the caller is the owner; session only; LAI-983)
POST   /api/v1/password-resets/consume       body { token, new_password } → { user_id, sessions_ended } — public; new_password as setup's (12–512); ends every session of theirs; refusals 404 unknown, 409 used / revoked / expired, 403 inactive, 429 throttled like sign-in (§6.1)
POST   /api/v1/users/:id/sign-out            end every session, not tokens → { user_id, sessions_ended }   (themselves; anyone else: owner, and admin by default; logged — LAI-981)
GET    /api/v1/users/:id/memberships         → { data: [{ project_id, slug, name, prefix, role, archived, joined_at }] } — membership rows only, narrowed to spaces the caller can read   (viewer+; LAI-981)
GET    /api/v1/users/:id/profile             PATCH .../profile  body { profile_kind }   (owner, admin; session only)
POST   /api/v1/users/:id/ratings             body { score, note } → 201   (owner, admin; session only; not yourself)
GET    /api/v1/people/:id/activity           ?range=12w|52w — the profile's heatmap by day   (owner, or a role granted *See everyone's analytics*; session only; logged, D-102)
GET    /api/v1/people/:id/time               ?day=&tz= — that person's GET /me/time answer, drafts, timer and day note included; logged   (owner, admin by default; session only; not yourself; LAI-957)
GET    /api/v1/people/:id/time/summary       ?from=&to= — that person's GET /me/time/summary answer; logged as a look at their time, no day   (owner, admin by default; session only; not yourself; LAI-526)
GET    /api/v1/people/:id/local-activity     ?days=1–14 — that person's GET /me/local-activity answer; logged   (owner, admin by default; session only; not yourself)
GET    /api/v1/me/analytics-views            ?limit=&cursor= — who looked at the caller → { data: [{ id, viewer: { id, name }, kind, day, viewed_at }], next_cursor }, newest first   (session only)
GET    /api/v1/users/:id/usage               one person's tokens, 12 weeks   (themselves, or owner / a role granted *See everyone's analytics*; session only; logged, D-102)
GET    /api/v1/usage                         ?days=1–92&project=&tz= — the Usage page   (owner/admin; a member with ?project=)
GET    /api/v1/invites                       POST /api/v1/invites    POST /api/v1/invites/accept
                                             POST takes optional expires_in_days: 1 | 7 | 30, default 7 (LAI-984)
                                             an invite never grants org_role 'owner' → 422 reason use_transfer (LAI-982)
                                             accepting a pending owner invite from before D-104 is refused the same and the invite stays unaccepted (sign-up: 422 auth_code use_transfer)
GET    /api/v1/invites/:token                unauthenticated preview — org name, inviter, role, expiry
DELETE /api/v1/invites/:id                   revoke a pending invite (admin+)
POST   /api/v1/invites/:id/reissue           body { expires_in_days? } — revoke a pending or expired invite and issue a new link for the same address, role and project, in one step → 201, POST /invites' answer; 409 if accepted   (as creating it: Invite people, and only the owner for an admin invite; LAI-984)
GET    /api/v1/projects                      POST /api/v1/projects   (admin+)
       └ each entry adds five fields §4.3 does not store — see below
       └ ?archived=include|only — archived projects whole rather than as tombstones, to their members and to `project.archive` holders; absent is unchanged (D-103)
GET    /api/v1/projects/:slug                PATCH /api/v1/projects/:slug
       └ PATCH takes { name, description, repo, visibility, color, prefix, task_create_min_role, agents_allowed, board_hide_done_days, archived } (lead+; archived: project.archive). A new prefix keeps every old key resolving; one another project holds is 409 on `prefix`, and one another project held is 409 with `reason: 'former'` (D-103)
POST   /api/v1/projects/:slug/join           (public projects)
POST   /api/v1/projects/:slug/leave          any member → { slug, implicit_access, notice }; the last lead 409 `last_lead` (D-103)
GET    /api/v1/projects/:slug/members        POST/PATCH/DELETE .../members
                                             DELETE takes an optional body { open_tasks } as deactivation does (LAI-986)
GET    /api/v1/projects/:slug/context        PATCH .../context       (lead+)
       └ GET answers the document with its `revision`; PATCH takes { context_md, base_revision } — base_revision required, the revision the write replaces; another is 409 `stale_context_revision` with { base_revision, current_revision } and nothing is written (§4.68, LAI-555)
GET    /api/v1/projects/:slug/context/revisions          newest first, no text: [{ revision, length, author_id, agent_id, created_at }]
GET    /api/v1/projects/:slug/context/revisions/:revision    one revision with its `body`; one the project has not reached is 404
GET    /api/v1/projects/:slug/context/diff   ?from=&to= → { from_revision, to_revision, current_revision, diff, added, removed, truncated, hint }; `to` defaults to current, `from` may be 0 (the empty document), from > to is 422
       └ at most 2,000 changed lines (added + removed) are answered; past that `truncated: true`, `diff: ''`, `added` and `removed` null, and `hint` names how to read the revision whole (`.../context/revisions/:to`, or `get_project_context` without `since_revision`). MCP answers the same `context_diff`
       └ all four context reads follow project read; a project the caller cannot see is answered **exactly as a missing one** — 404 to a person, and to an agent's token the 403 `agent_not_granted` it gets for any slug it may not use (LAI-555)
GET    /api/v1/projects/:slug/budgets        PUT /api/v1/projects/:slug/budget  body { tokens | null }   (set: lead, session only; LAI-773)
GET    /api/v1/projects/:slug/tasks          ?status=&status_id=&assignee=&priority=&ready=&sprint=&tag=&parent=&updated_since=&cursor=&fields=
                                             status is a category (§4.5), status_id one project status (§4.20);
                                             fields=slim leaves out description_md and acceptance_md (LAI-795)
                                             each task carries `handoff`, its saves and hand-off in brief (LAI-1005), read once
                                             for the page returned, whatever its size and however many `ready=` batches were
                                             walked to fill it — see the task shape below
GET    /api/v1/projects/:slug/statuses       POST .../statuses  body { name, category, position? } → 201  (lead+)
PATCH  /api/v1/projects/:slug/statuses/:id   body { name?, hidden? } — category is refused   (lead+)
PUT    /api/v1/projects/:slug/statuses/order body { ids } — every status exactly once   (lead+)
DELETE /api/v1/projects/:slug/statuses/:id   body { move_to } — moves the work, then deletes   (lead+)
GET    /api/v1/projects/:slug/sprints        POST /api/v1/projects/:slug/sprints   (lead+)
       └ each entry adds `task_counts`, derived at read time — see below
GET    /api/v1/sprints/:id                   PATCH /api/v1/sprints/:id   DELETE /api/v1/sprints/:id  (lead+)
POST   /api/v1/sprints/:id/tasks             body { task_ids[] }  — assign into the sprint
DELETE /api/v1/sprints/:id/tasks/:taskId     remove from the sprint (task itself is untouched)
GET    /api/v1/sprints/:id/forecast          "N% likely to finish X–Y of Z" (LAI-772; computed, cached)
PUT    /api/v1/sprints/:id/budget            body { tokens | null } — the sprint's token budget   (lead, session only; LAI-773)
GET    /api/v1/projects/:slug/tags           list with usage counts, for the picker and the filter
PATCH  /api/v1/projects/:slug/tags/:name     rename project-wide (lead+)
DELETE /api/v1/projects/:slug/tags/:name     remove from every task (lead+); tasks are untouched
GET    /api/v1/projects/:slug/timeline       ?from=&to=  — sprints with date ranges and their tasks
POST   /api/v1/projects/:slug/tasks
GET    /api/v1/tasks                         ?project=&status=&assignee=&sprint=&updated_since=&cursor=&fields= — every project the caller may read
                                             (project.read per project); the per-project list's task shape and order; any other filter is 422 (LAI-887)
GET    /api/v1/tasks/summary                 /tasks' filters, same set → { total, by_status, by_assignee: [{ user_id|null|'others', name, count }] (top 10, then others), overdue, blocked, unassigned } (LAI-974)
GET    /api/v1/tasks/:id                     PATCH /api/v1/tasks/:id
POST   /api/v1/tasks/:id/claim               POST /api/v1/tasks/:id/status
                                             claim: body { branch?, estimate?, session_id? }, optional — the branch is kept
                                             on the task (LAI-770); estimate { size?, confidence? } (§4.34); on a registered
                                             agent's token it takes the exclusive claim (§5, §4.66) under session_id, or a
                                             new session, and answers X-Laika-Claim-Generation and X-Laika-Agent-Session
POST   /api/v1/tasks/:id/claim/reclaim       body { session_id? } → { claim, session, from_generation } — the explicit reclaim
                                             (§9.1, LAI-541); a registered agent's token only
POST   /api/v1/tasks/:id/checkpoints         body { id, idempotency_key, repo, branch, commit_sha, manifest, summary?, summary_commit_sha? }
                                             → 201 checkpoint; the same key again → 200 that checkpoint (§4.70, LAI-545).
                                             The live claim's holder only, with X-Laika-Claim-Generation
GET    /api/v1/tasks/:id/checkpoints         newest first, each with its refs, `verification`, `pending_since`, `superseded`
POST   /api/v1/checkpoints/:id/refs          → 201 { ref, revision, verification } — registers the next re-tag before it is
                                             pushed (`laika agent checkpoint reverify`, D-116 item 7); task.checkpoint.retag
GET    /api/v1/agents/:id/checkpoint-consent → { given, given_by_user_id, given_at, withdrawn_at } (§4.75; the owner, or the agent's own token)
PUT    /api/v1/agents/:id/checkpoint-consent DELETE .../checkpoint-consent — give / withdraw (agent.manage_own, session only)
POST   /api/v1/tasks/:id/handoff-offers      body { idempotency_key, to_agent_id, checkpoint_id, reason } → 201 offer;
                                             pauses the caller's live claim (§4.73, LAI-546)
GET    /api/v1/tasks/:id/handoff-offers      every offer on the task, newest first, work requests included
GET    /api/v1/agents/me/inbox               the calling agent's live work requests and offers, newest first (agent_sync's twin)
GET    /api/v1/handoff-offers                ?view=received|sent|needs_approval|recovery, project?, include_closed?, limit?, cursor?
                                             → { data, next_cursor, counts } — a signed-in person's hand-off inbox (LAI-1009)
POST   /api/v1/handoff-offers/:id/approve    body { to_agent_id? } → offer, `open` (session only; the task's assignee or a lead,
                                             never the receiver's owner); to_agent_id names an unnamed recovery's receiver
POST   /api/v1/handoff-offers/:id/accept     body { verified_commit_sha, session_id? } → { offer, claim, session }
                                             and X-Laika-Claim-Generation: the receiver's new claim at generation + 1
POST   /api/v1/handoff-offers/:id/decline    body { reason? } → offer; the sender's claim resumes
POST   /api/v1/handoff-offers/:id/cancel     → offer; the sender's claim resumes
GET    /api/v1/projects/:slug/handoff-policy PUT .../handoff-policy  body { allow_other_owners?, cross_owner_requires_approval?,
                                             max_handoffs?, offer_ttl_minutes? }   (§4.74; set: lead)
POST   /api/v1/tasks/:id/finish              body { summary, checklist?, commits?, branch?, pull_request?, tests? }
                                             → review, with a round and its proof (finish_task's twin, D-082)
GET    /api/v1/tasks/:id/rounds              { rounds (newest first), send_back }
GET    /api/v1/tasks/:id/estimate            size, why, forecast frozen at start, actual, history (D-085)
GET    /api/v1/tasks/:id/usage               ?tz= — its tokens: per person and agent, per round, attributed share (D-084, LAI-770); cost, budget, runaway (LAI-773)
PUT    /api/v1/tasks/:id/budget              body { tokens | null } — null goes back to the frozen forecast's p80   (lead, session only; LAI-773)
GET    /api/v1/projects/:slug/estimates/accuracy  per project, and per agent client with ≥ 3 people; never per person
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
GET    /api/v1/activity/history              ?actor=&project=&type=&since=&until= — every row, newest first   (owner, admin)
                                             ?format=csv — the same filters and gate, every row as one streamed text/csv file (no limit or cursor; LAI-984)
GET    /api/v1/tokens                        POST /api/v1/tokens     DELETE /api/v1/tokens/:id
GET    /api/v1/users/:id/tokens              DELETE /api/v1/users/:id/tokens/:tokenId  (admin+)
GET    /api/v1/agents                        POST /api/v1/agents  body { display_name, harness, device_label?, grants[{ project_id, scope }], expires_at? } → 201 { agent, token, secret }  (§4.63, session only)
GET    /api/v1/agents/devices                own agents grouped by device → { data: [{ device_label, display_name, recognised, last_seen_at, active_count, revoked_count, agents }] } (§4.63, agent.read_own)
POST   /api/v1/agents/devices/confirm        body { device_label: string | null } → { device_label, recognised: true } (agent.manage_own, session only)
POST   /api/v1/agents/devices/revoke         body { device_label: string | null } → { revoked_agent_ids: string[] } (agent.manage_own, session only)
GET    /api/v1/agents/:id                    PATCH /api/v1/agents/:id  body { display_name?, harness?, device_label? }
PUT    /api/v1/agents/:id/grants             body { grants[{ project_id, scope }] } — replaces the set (§4.64)
POST   /api/v1/agents/:id/rotate-token       body { token_id, expires_at? } → 201 { agent, token, secret }; the old token is revoked in the same transaction
POST   /api/v1/agents/:id/revoke             the agent and every live token it holds; idempotent
GET    /api/v1/agents/me/work-requests       ?project= optional — the calling agent's open work requests (LAI-535); an agent's token only
POST   /api/v1/heartbeats                    202, token auth only
POST   /api/v1/agent-sessions                body { client_version?, harness?, harness_version?, model? } → 201 session (§4.65); an agent's token only (LAI-541, D-118)
POST   /api/v1/agent-sessions/:id/heartbeat  body { client_version?, harness?, harness_version?, model? } optional → { session, claims, lost } — renews the session's active claims (§9.1); a field sent replaces what the session said, one omitted is kept
POST   /api/v1/agent-sessions/:id/end        → session; its live claims are released
GET    /api/v1/presence                      GET /api/v1/capacity
GET    /api/v1/permissions                   every org and project action: label, scope, which roles hold it, conditions; and the caller's own grants (viewer+; LAI-885) — answered under the organisation's grants (LAI-958)
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
parent_task_id, due_on, planned_start, external_ref, selected_agent_id }`.
**`null` clears a field; absent leaves it alone** — they are different requests,
and `acceptance_md`, `assignee_id`, `parent_task_id` and both dates draw the
distinction. `tags` replaces the whole set. `POST /projects/:slug/tasks` takes
the same three optional fields (`parent_task_id`, `due_on`, `planned_start`)
beside `discovered_from`. Both take `external_ref`, an outside id (§4.5) —
anything of another shape is `422` on that field, and one another task of the
project holds is `422` with `details: { field: 'external_ref', reason:
'taken', external_ref, task }` — and `PATCH` clears it with `null` (LAI-780).
An `assignee_id` on either must name somebody who can read the project on their
own authority — `project.read`, so an org Owner or Admin with no membership row
counts — or it is `422` with `details: { field: 'assignee_id', reason:
'not_on_project', assignee_id }`; MCP's `assignee` reaches the same check
(LAI-962). `?parent=<id>` on the list returns that task's
subtasks only, and pages with `cursor` like any other filter (D-066).

**A `PATCH` may be conditional** (LAI-571). `GET /tasks/:id` and every
successful `PATCH /tasks/:id` carry a strong `ETag`: the task's **version**,
a digest of the task exactly as that response returns it, so any change a
read of the task would show — its fields, tags and tag names, size,
dependencies in either direction and their readiness, sprint, comments
count, send-back, who holds its live claim — gives it a new version, whatever
wrote it. The live claim's `last_heartbeat_at`, `lease_expires_at` and
`connection` are left out: they move with heartbeats and the clock, not with
a write. A `PATCH` that
sends `If-Match` with that value is applied only if the task's version still
equals it, checked and written in one transaction; otherwise it is
`409 conflict` with `details: { current, etag }`, the task as
`GET /tasks/:id` would return it and its version, and nothing is written —
not a field, a tag, a selection or an activity row. `If-Match` other than one
ETag as a read sent it — `*`, weak `W/` tags and lists included — is
`400 bad_request` with `details: { header: 'If-Match' }`. Without `If-Match`
a `PATCH` is unconditional, as before. `updated_at` is the time of the last
edit and is not the version. MCP's `update_task` takes no precondition.

**Every row of a task list carries its own `etag`.** On `GET
/projects/:slug/tasks` and `GET /tasks`, each row has `etag`, the same quoted
value a `GET /tasks/:id` of that task would send as `ETag`, so a client can
make a guarded `PATCH` straight from a list. It is the version of the full
task, so a `?fields=slim` row carries it too. A single task's body does not
repeat it: the header is its `etag`.

**`selected_agent_id`** (§4.5, D-114 item 7, LAI-535) selects the agent meant
to do the task and opens a work request for it; `null` withdraws the request,
and the same id again changes nothing and writes nothing. It never moves
`assignee_id`. An agent that cannot be selected is `422` with `details: {
field: 'selected_agent_id', reason, selected_agent_id }`, `reason` one of
`agent_not_found`, `agent_other_owner`, `agent_wrong_org`, `agent_revoked`,
`agent_not_granted`, `agent_read_only` or `agents_off`. **Changing it while
an agent session holds the task's live claim is `409 conflict`, `reason:
claim_held`** — that change is a hand-off (LAI-546): accepting one sets
`selected_agent_id` to the receiver in the accept's own transaction (§4.73);
with no live claim it is free to change (LAI-541). **The selected agent owns the claim** (D-119,
LAI-586): *"When a task has a selected agent, only sessions of that agent may
claim it. Any other agent gets `409 conflict` with reason
`selected_for_another_agent`, naming the selected agent if the caller may see
it. With no selected agent, any eligible agent may claim, as today."* That
holds for `POST /tasks/:id/claim`, `start_working` and both reclaims (§6.3),
and it is asked **before the assignee rule**, so an agent that is not selected
always hears `selected_for_another_agent`, never a bare *already claimed*; the
selected agent meets the assignee rule as before. The selected agent's claim
— **and its reclaim** — accepts its open work request in the same transaction,
so a request can no longer stay open beside another agent's claim, or beside
its own reclaimed one. A person and a legacy token
claim by assignee as before, and reads and comments are never refused for it.
**A live claim the selection does not back** — taken before D-119, or before
the selection; the API cannot make one any more — is never renewed and never
usable: the claim, the reclaim and the fence all answer it
`selected_for_another_agent`. It ends at its holder's next heartbeat (reported
in `lost`) or when its lease lapses, whichever is first, as **`released`**, not
`expired` — an expired claim waits for its holder's reclaim or for recovery,
and this holder may never reclaim, so `expired` would lock the selected agent
out. The system records it as `task.updated`, `{ field: 'claim', from: {
generation, session_id, agent_id }, to: null, reason:
'selected_for_another_agent' }`. While it is live the selected agent hears
`claim_held`; it is never taken over.
`GET /agents/me/work-requests` is the calling
agent's open requests, newest first, paged like any list, each `{ id, kind,
state, task_id, task_key, task_title, project_id, agent_id, requested_by,
created_at }`, limited to the projects the agent may read now — and to one with
`?project=<slug>`, which is looked up **only among those**: a slug the agent
may not use, real or made up, gets one refusal, identical byte for byte — `403
forbidden`, `reason: agent_not_granted`, no slug or id in the body — so the
answer never discloses whether the project exists. MCP's `list_ready_tasks`
`project` argument answers an agent's token the same way, before its task list
is read; a token that is
not a registered agent's — or a session — is `403` with `reason:
not_an_agent`.

`GET /agents/devices` returns the complete derived groups (no pagination,
so a device is never split). `device_label` is the normalised label, or null
for the unnamed group; `display_name` uses the newest agent's trimmed label,
or *Unnamed device*. `agents` contains the same shapes as `GET /agents`.
Confirm and revoke normalise the supplied label in the same way. A known
device with no active agents revokes successfully with an empty id list.
§7.1 has no agent-list tool, so no device MCP read or management tool is added.

**Agent sessions and claims** (§4.65, §4.66, §9.1, LAI-541). A session is `{
id, agent_id, started_at, last_heartbeat_at, ended_at, end_reason,
client_version, harness, harness_version, model, connection }` — the four
self-reported fields labelled as such and never read by `can()`, the fence or
a claim (D-118: *"Each session records what actually ran, self-reported and
labelled as such"*); `GET /agents/:id` answers the agent with `sessions`, its
twenty most recent, newest first, and every activity row (§4.8) carries
`agent_session: { id, harness, harness_version, model } | null`, the snapshot
taken when it was written. A session's `connection` is one of `live`, `suspect`
(silent past §9.1's suspect interval) or `ended`; a claim is `{ id, task_id,
session_id, agent_id, generation, state, lease_expires_at, created_at, ended_at
}`. A task read — `GET /tasks/:id` and the task lists — carries `claim`, the
task's live claim (`active` or `paused`) or `null` (LAI-568): `{ generation,
state, agent_id, session_id, lease_expires_at, last_heartbeat_at,
heartbeat_age_ms, connection, suspect_after_ms, device_label, harness,
harness_version, model }`, with `heartbeat_age_ms` and `connection` (`live`
or `suspect`) as of the read by the server's clock — a client ages the claim
from `heartbeat_age_ms` on its own elapsed time and never compares
`last_heartbeat_at` with its own clock (LAI-597) — and the last three the
holding session's self-reported fields as it last sent them — `null` where it
sent none, and deciding nothing (LAI-593). Every task read also carries
`handoff` (LAI-1005), never null: `{ checkpoint, offer, recovery_available,
save_needs_attention }`. `checkpoint` is the task's newest save, `{
verification, saved_at, pending_since, pending_notice }` as `GET
/tasks/:id/checkpoints` reports it, or `null`; `offer` is its newest live
hand-off or recovery offer, `{ kind, state, requires_approval }`, or `null`.
**`recovery_available`** is derived here once — the task is `in_progress`, its
newest claim `expired`, and a live recovery offer or a `verified` checkpoint
lets work continue (§4.73) — and **`save_needs_attention`** is the newest
checkpoint `uncertain` with no live claim and no recovery available; a
receiver's failed fetch (LAI-548) is not reported. It names no agent, session
or commit, and is served under the same *Read tasks* as the checkpoint and
offer reads, so it shows nothing they would not. A heartbeat answers `{ session,
claims, lost }`: the live claims it renewed,
and the session's claims that are no longer live — **an expired one stays in
`lost`; a heartbeat never brings it back**. A heartbeat to an ended session is
`409`, `reason: stale_claim`. All three `/agent-sessions` routes are under
`heartbeat.send_own` and refuse a session or a legacy token `403`, `reason:
not_an_agent`; another agent's session is `404`. **The reclaim** reads
everything again **inside its `BEGIN IMMEDIATE`**, from the database, not from
the request's resolved actor — the agent's status (`403`, `reason:
agent_revoked`), the token (`token_revoked`; `token_read_only` if it is not
`full`), the owner (`owner_inactive`), then the task — **one the caller can no
longer read is `404 not_found`, `No such task`, byte for byte what a task that
does not exist answers** (LAI-586 review; a removed grant lands here) — the
agent's grant (`agent_read_only`) and the owner's `task.claim` under today's
role. `POST /tasks/:id/claim` and `start_working` answer a task the caller
cannot read the same way, before `task.claim`. A task no
longer in progress is `409`, `reason: task_not_claimable`; a live claim is `409
claim_held`; a task whose newest claim is not this agent's expired one is
`409`, `reason: nothing_to_reclaim`. **With the offers** (§4.73, LAI-546), the
same transaction refuses `409 conflict`, `reason: offer_taken`, when a
**hand-off or recovery** offer whose `from_claim_generation` is the generation
being reclaimed has been accepted — a work request never counts, and an older
generation's accepted hand-off is history, not a rival. Otherwise it
**invalidates every outstanding offer on the task** before inserting the new
claim: each live hand-off and recovery offer becomes `cancelled`,
`closed_reason: reclaimed`, one `task.handoff_cancelled` row each; the open
work request, if any, is accepted by the reclaim as the D-119 paragraph above
says.

**Checkpoints** (§4.70 – §4.72, D-115, D-116, LAI-545). A checkpoint is `{ id,
task_id, session_id, agent_id, claim_generation, repo, branch, remote_ref,
commit_sha, manifest, summary, summary_commit_sha, created_at, verification,
verified_at, pending_since, superseded, refs: [{ ref, revision, state }] }` —
`pending_since` the time it has waited for its notice, null unless `pending`;
`superseded` derived on read. **Push, then register** (D-116 item 1): the
helper pushes the work branch, then the one lightweight tag
`laika-ckpt/<LAI-NNN>/<checkpoint-id>` alone in its own `git push`, then
registers. So the helper needs the id before the push: **it mints the
checkpoint's `id`, a ULID, and sends it** with the registration, and the
server builds `remote_ref` from it — `refs/tags/laika-ckpt/<task>/<id>`,
`<task>` the task's `external_ref` when it has one (`LAI-NNN` in this repo,
§4.5) and its key otherwise. An `id` that is not a ULID, or that another
checkpoint already has under a different `idempotency_key`, is `422` with
`field: 'id'`. **A retry with the same `idempotency_key` and the same body**
answers the checkpoint already registered, `200`, matched after the caller's
own checks (token, agent status and grant, `task.checkpoint.create`) and
**before** the claim fence — so a save whose answer was lost still finds it
after its session offered the task. A registration answers at once with `verification: 'pending'` unless a delivery
for the ref arrived first (§4.72), and **the server never fetches the ref, a
URL or GitHub to check it** (D-083). **A re-tag** (`POST /checkpoints/:id/refs`)
registers `…-r<n>` before the helper pushes it, and sets the checkpoint back to
its new ref's state at that moment — normally `pending`, with `pending_since`
restarting — which is the one change to `verification` that no delivery makes
(§4.71). `summary` is the five-field note of §4.70;
a body field outside it is `422`. Saving needs the task's live claim, so the
fence (§6.3) refuses a paused, stale or other session's save; **automatic**
saves are the helper's and need §4.75's consent, which the server does not
see — it records what is registered.

**Hand-off offers** (§4.73, §4.74, LAI-546). An offer is `{ id, task_id, kind,
state, from_session_id, from_agent_id, from_claim_generation, to_agent_id,
checkpoint_id, checkpoint_commit_sha, checkpoint: { commit_sha, verification,
summary, summary_commit_sha } | null, reason, note_hash, requires_approval,
approved_by_user_id, approved_at, expires_at, accepted_session_id,
accepted_claim_id, receiver_commit_sha, closed_reason, created_by_user_id,
created_at, closed_at }` — the column names, unchanged on the wire;
`checkpoint` is null once retention removed it. An offer retry is matched as
§4.73 says, before the fence. **Consent** (§4.75): `PUT` gives it, `DELETE`
withdraws it, both the owner's, signed in; `GET` answers the owner and the
agent's own token, so the helper knows whether it may save on its own. Giving
or withdrawing writes no `activity` row — it is a setting of the agent, as its
grants are (§4.64). Every write route is one `BEGIN IMMEDIATE`
transaction with §4.73's rules and §6.3's reasons. **The accept is the
receiver's acknowledgement, not proof** (D-116 item 8): the supported helper
(`laika agent accept`, LAI-548) fetches the checkpoint's newest ref, refuses
locally if it is missing or resolves to another SHA, checks the commit out in
a fresh worktree, and only then sends `verified_commit_sha`; the server can
only compare that SHA with the checkpoint's. Another client that sends it
takes responsibility for having checked. `GET /agents/me/inbox` is `{ data:
[…], next_cursor }`, each item a work request as `GET
/agents/me/work-requests` returns it or an offer as above, **live only**,
limited to projects the agent may read now; Phase 4's delivery states
(`received`, `presented`) are not on it yet. **`GET /handoff-offers` is a
person's inbox** (LAI-1009), the one the web Inbox's *Hand-offs* tab reads: an
agent's token is `403` with `reason: use_agent_inbox` and keeps `GET
/agents/me/inbox`. Each row is a hand-off or recovery offer with its task (`id`,
`key`, `title`, project), `from_agent` and `to_agent` as the task's selected
agent is shown (harness, device, owner), the checkpoint's `verification` and
`saved_at`, the `reason` (untrusted data), `requires_approval`, `approved`,
`expires_at`, and `next_action` — what the caller can do now (`approve`,
`name_receiver`, `accept_with_your_agent`, `cancel`, `wait_for_approval`,
`wait_for_receiver`, `none`). It names **only what would succeed now** —
`accept_with_your_agent` where one of the caller's agents passes §4.73's
receiver rules (active, `full` grant, an owner who may accept, the policy's
owner rule), nothing waits for approval and the checkpoint is `verified`;
`name_receiver` only where an eligible agent of **another** owner exists,
since naming one's own is `approver_is_receiver` — and the writes ask `can()`
again. A `project` that names nothing and one the caller cannot read answer
the same body, `404` *No such project*.
`received` is offers to an agent the caller owns; `sent`, hand-offs from one;
`needs_approval`, `pending_approval` offers the caller may approve (*Approve a
cross-owner hand-off*, §3.2) and **never one whose receiver they own**;
`recovery`, every recovery offer. Absent or empty `view` is `received`, and
another is `400 bad_request` with `details: { view }`. Only projects the caller
may read now are answered, and a `project` they cannot read is the missing
slug's `404`. Rows are live and unexpired unless `include_closed=true`, where a
live offer past `expires_at` reads `expired`; `counts` holds every view's
number, live and unexpired only, for the badge. Work requests are not on it:
they are the agent's to answer. A policy the project never set
reads as the defaults (§4.74); `PUT` writes the whole row from the defaults
plus what it was sent.

**A slim list: `?fields=slim`** (LAI-795). The task list answers every field
of the task view below **except `description_md` and `acceptance_md`**, the
rest in the same order, on the same pages and with the same `next_cursor`, and
with every filter. **Without it the answer is unchanged** — agents, the CLI and
other clients read the list whole. `slim` is the only value: any other is `400
bad_request` with `details: { fields }`, and an empty one reads as absent, as
every filter's does. The two texts were 83% of a gzip'd 200-task page (LAI-786)
and nothing that draws a list renders them, so **the web app reads every list
slim** — the store's walk and its live refresh, the Timeline's sprints, a
panel's subtasks — and **the task panel reads the task in full with `GET
/tasks/:id` when it opens**, and again when the task's `updated_at` moves past
the copy it holds. `GET /tasks/:id` and every write still answer the whole
task.

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
| `activity_sharing` | `{ org_enabled, enabled }` — since D-102 (amended) both are the organisation's Developer insights (`enabled` kept for older clients) — whatever their kind, so the Activity card is drawn in its final shape before `GET /people/:id/activity` answers (LAI-751). Whether their pushed and local work may be shown, never a count of it |
| `current_work` | their tasks in progress, oldest start first, and in review, longest waiting first — each review task with `review_since`, its entry into Review by `review`'s rule, null when the log cannot say (LAI-751); each list at most 50, with `in_progress_total` and `in_review_total` |
| `delivery` | `accepted_per_week` and `accepted`: moves of their tasks into a Done status (D-077) by someone else; `sent_back`: Review to an earlier status by someone else; `reopened`: Done back into work; `cycle_time`: p50/p75 of `completed_at − started_at` for their tasks done in the window, the unstarted ones counted as `unmeasured` |
| `agents` | their usable tokens with the agent each last connected as (D-076), most recently used first, at most 50 with `tokens_total`; which agents are online now (§9.3) — never where; and `writes`: their `activity` rows made through a token in the window, grouped by the agent that token last connected as, most first, with `writes_total` — revoked tokens' writes included (LAI-750). Org owners and admins reading a person's profile (`profile.read`) see that person's token names, registered agents included; this is access oversight, the one exception to D-120's owner-only name rule. |
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
  zeros — **unless the organisation's Developer insights is on now** (§4.2; D-102 amended); then
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

- `GET /me/activity-sharing` answers `{ org_enabled, enabled,
  person_can_opt_out, scope, min_sync_interval_s }` — `600`, how often a
  collector may sync — to a session or any token of theirs, so a collector
  asks before it sends. **Collection is the organisation's** (D-102 amended,
  LAI-963): `enabled` is whether this person's local activity is collected,
  and equals `org_enabled`; `person_can_opt_out` is always `false`. `enabled`
  is kept so a collector written against D-079's two switches syncs exactly
  when it may. Asked
  with `?collector_id=<uuid v4>` by a caller who may send (not a `read_only`
  token) with collection on, it adds `usage_days_elsewhere`: the days, back
  to today − 32 in UTC, that **other** collectors of this person hold token
  rows for — dates only, never a count (D-084, LAI-769 review 1). The preview
  below is session only, so this is how a collector learns which days of a
  30-day backfill not to send again. Asked the same way it adds
  `task_prefixes`: the key prefixes of every project the sender may read,
  and of the outside ids (§4.5) on tasks in those projects, sorted (LAI-770,
  LAI-780). A key in a branch name counts for a task only when its
  prefix is one of them, so `release-2026` or `gpt-5` is never taken for a
  task; the collector keeps the last answer.
- `PUT /me/activity-sharing` takes `{ scope? }` — `agent-repos` or
  `laika-repos` — from a **web session only** and answers the same shape. A
  body carrying `enabled`, on or off, whatever the organisation's switch, is
  refused `403` with `details: { reason: "organisation_controlled",
  org_enabled }` and writes nothing, its `scope` included: the switch is no
  longer the person's (D-102 amended). `enabled` stays in the body's schema so
  that is the answer an old client gets, not `422`'s unknown field. No
  `activity` row: §4.8 has no verb for it.
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
- **A usage report** (D-084, LAI-769) is the same `PUT` marked `"usage":
  true`: `{ "v": 1, "collector_id", "tz", "usage": true, "days": [{ "day":
  "YYYY-MM-DD", "rows": [{ "agent", "model", "task", "input", "output",
  "cache_write", "cache_read", "automated"? }] }] }` — per day × agent × model
  × task × automated the four token counts the agents' own session files
  record. `automated` is `true` on a row an automated session spent (D-091,
  LAI-815; §4.33) and absent otherwise — anything else is refused — so a
  collector from before it sends every row as the person's. `agent` is an agent
  kind id as above; `model` is 1–64 of lowercase `a–z`, `0–9`, `.`, `_`, `:`
  and `-` (the collector removes Claude Code's `[1m]` suffix and drops
  `<synthetic>`); `task` is `null`, a Laika key `PREFIX-n`, or an outside id
  (§4.5), upper case; each count an
  integer 0 to 10¹²; at most 200 rows a day; anything else in a day or a row
  is an unknown field. Each day once, within *today − 31* to *today + 1* in
  `tz` (the last 30 days may be sent once, D-084 item 11), the same **16 KB**
  and the same bucket. **Each (person, collector, day) it carries is
  replaced** by its rows — a day sent with no rows empties — so a retry never
  counts twice (§4.33). **A day may carry `"backfill": true`** — tokens from
  before that collector began counting, the 30 days of D-084 item 11, marked
  the first time the day is sent. Such a day **also replaces every other
  collector's rows of that person for that day and each agent it names**: a
  machine whose collector started over (`laika activity off`, then `on`) cannot
  count a day twice, even if its client gets the next rule wrong (LAI-769
  review 1). The collector asks `GET /me/activity-sharing?collector_id=` first
  and leaves the older tokens out of a day another collector already holds.
  A key is kept only when it names a task in a project the sender may read;
  any other is stored unattributed. A key that names no task is tried as an
  outside id, among the projects the sender may read; one that two of those
  tasks carry is stored unattributed (LAI-780). **Where the key comes from** (D-084 item
  5, LAI-770): the agent's own Laika calls in that session, read by the
  collector from the session file — `start_working`, or `update_status` into
  an in-progress status, starts work on the task, and another mark,
  `finish_task` or a move of that task out of progress ends it, so a session
  that moved between tasks is **split by time**; a subagent's own marks are
  its own; a call the board refused is no mark. Without a mark, a key in the
  branch name whose prefix is in `task_prefixes`. Only the key is sent;
  anything else is `null`. A backfilled day's older tokens are always `null`
  (D-084 item 11). No `activity` row. It
  answers `200 { "accepted_days": n }`. **Never** prompt or reply text, tool
  input, paths, repository or branch names, or session ids: there is no field
  that could carry one.
- **Sessions, by one-way key** (LAI-773, D-087) — so OpenTelemetry can be
  matched to the files without either counting twice. A usage report's day
  may carry `"sessions": [{ "key", "model", "input", "output", "cache_write",
  "cache_read" }]` — the day's Claude Code rows split by session, subagents
  under their parent, at most 100, an automated session's never — and the
  report may carry `"excluded": ["<key>", …]`, at most 200: the sessions whose
  telemetry is to be dropped, automated ones (D-086; their tokens are the
  rows marked `automated`, D-091) and those outside the developer's
  `laika-repos` scope (D-079 item 4) — **sent only when Claude Code on that
  machine exports its metrics to this board** (telemetry on, an OTLP metrics
  exporter, an endpoint under `/api/v1/otlp/`, in `~/.claude/settings.json`'s
  `env` — where `laika activity on` writes them (LAI-867) — or the
  environment; review): with none from there, there is nothing
  of theirs to drop. A key is
  the first 16 hex of `sha256("laika-session:" + session id)`, lower case —
  never the id. Each (person, collector, day) carried replaces
  that machine's session rows (§4.38); a day sent without `sessions` leaves its
  Claude Code file tokens *unplaced*, which keeps the match safe (§4.38). A key
  in `excluded` drops that session's telemetry, before and after.
- **Each session's split between tasks** (LAI-787, D-088 item 8). A day may
  also carry `"session_tasks": [{ "key", "task", "tokens" }]`, at most 200: per
  Claude Code session key and task key, the headline tokens it spent on that
  task that day — the split its marks and branch made. Each (person, collector,
  day) carried replaces that machine's split (§4.51); only a key the sender may
  read is kept. It ties the session's agent minutes to cards the way its
  tokens are tied.
- Refusals, in §6.3's envelope with the contract's reason in `details.reason`:
  `403 local_activity_off` when the organisation's switch is off (asked before the body is
  judged); `422 day_out_of_range` when `days` is empty, longer than 14, repeats
  a day, or holds a day that is not a date within *today − 14* to *today + 1*
  in `tz` — for a look-back, *today − 400* to *today + 1*, for a usage report
  *today − 31* to *today + 1* — with that window's `earliest` and `latest` in
  `details`; `422 invalid_tz` for a zone the server
  does not know; `422` for any
  unknown field, wrong type or cap; `413` over 16 KB; `429` with `Retry-After`
  once the report bucket is spent — 30, refilled one every 120 seconds, per
  token (per user for a session; §6.3). A collector that
  is refused `local_activity_off` stops and asks again after 24 hours.
- **Which commits count** (settled with the collector, LAI-752; D-080):
  `commits_local` covers only commits the developer authored **after their
  machine was connected**, and **merge commits are counted in neither** it nor the
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
  typing in count nothing for the person**: the activity hook counts nothing
  when `OMNIGENT=1`, `CI` or `LAIKA_ACTIVITY_SKIP` is set (D-080), and keeps
  only that session's id, from its start and end payloads, in a local file
  never sent (LAI-775). The collector sends that session's tokens — subagents,
  Codex and Gemini CLI files included — as rows marked `automated`, tied to a
  task by the same marks and branch rules (D-091, LAI-815): the
  organisation's, the space's and the task's, never the person's, and still
  no prompts, sessions or drafted time. Sessions from before activity was on
  cannot be told apart.
  **Tokens arrive while a session runs** (LAI-776): Claude Code's `Stop` hook,
  which fires at the end of every turn, launches the detached sync only when
  `next_sync_at` has passed — fork-free otherwise under zsh, as the prompt path
  is — so a running session's tokens reach the board within one sync interval
  rather than at its end. `laika activity otel` prints the OpenTelemetry
  settings above for this machine.
- `GET /me/local-activity?days=` (1–14, default 14) answers what is held for
  the caller over their last days — `{ start, end, tz, days: [{ day,
  prompts_by_agent, sessions, commits_local, pushed_commits, tokens,
  cache_read }], collectors, oldest_day }`, newest first, only days with
  something held — `tokens` and `cache_read` their agents' token totals that
  day (D-084 item 4), automated sessions' rows included, since they are held
  under the caller's account (§4.33), and `oldest_day` counting token rows
  too — **whatever the switches say**: what was kept before sharing was
  turned off is still theirs to see. `DELETE /me/local-activity` removes every
  local row, pushed key and token row of theirs, `204`. Both **web session
  only**: an agent must not read back or erase what is held about its person.

**Token usage, read back** (D-084, LAI-769) — §4.33's rows, for the Usage page
and the profile's Tokens card:

- `GET /usage?days=&project=&tz=` — `days` 1–92 (default 30), the range ending
  today in `tz` (default `UTC`; `422 invalid_tz` for a zone the server does not
  know). Without `project` it is the organisation, `usage.read_org` (owners and
  admins; a token may read it); with `project=<slug>` that space,
  `usage.read_project` (§3.2, anyone in it). It answers `{ from, to, tz, days,
  project: { slug, name } | null, totals: { tokens, input, output,
  cache_write, cache_read, attributed_tokens }, trend: [{ day, tokens,
  cache_read }], by_developer: [{ user_id, name, tokens, cache_read,
  attributed_tokens }] | null, by_agent: [{ agent, tokens, cache_read,
  few_people? }], by_model: [{ model, tokens, cache_read, few_people? }],
  by_project: [{ project: { slug, name }, tokens, cache_read, cost, share }]
  | null, top_tasks: [{ task_id, key,
  title, project_slug, tokens, cache_read }], no_token_data: [agent],
  org_totals, rework }`. `by_project` (LAI-814) is the organisation's figure
  per space: `null` for a space, and otherwise each space the reader may read
  (§3.2's `usage.read_project`, the rule `rework` and `cache_by_project`
  follow) with tokens in the range, most tokens first — from one range of the
  project index grouped by project and model, `cost` priced as `totals.cost`
  is, caveats included, and `share` the space's part of `totals.tokens`
  (`null` when that is 0). A space's total names nobody, so it is not
  `usage.read_people`'s. **`totals.tokens` less the rows is what no space the
  reader may read holds** — for an owner or admin, the tokens outside any
  space — and the page shows it as the last row, so the rows add up to the
  organisation's total. `rework` (LAI-772) is, per project the reader may
  read and in name order, `{ project: { slug, name }, send_backs, tasks,
  tokens, cache_read, time_ms, open, share }` for send-backs decided in the
  range: the tokens tied to the task on days after the round sent back (in
  `tz`), the time from each send-back to the next finish or to now, and the
  share of the project's tokens that was rework — **never per person**. **A space holds only tokens tied to its tasks**, so beside one
  `org_totals` is the organisation's totals over the same range — what no
  space can hold — for a reader holding `usage.read_org`, and `null` otherwise
  and for the organisation itself.
  **`tokens` is input + output + cache writes**; cache reads are always beside
  it, never in it (D-084 item 8). `trend` has every day of the range, zeros
  included. **`by_developer` is `null` unless the reader holds
  `usage.read_people`** — an owner or admin on a web session — so a member and
  every token get totals only (D-084 item 7); when present it is in name
  order, never ranked by volume, and holds each person's own tokens only:
  rows marked `automated` are in every other figure here and in no person's
  (D-091, §4.33). **An agent or model fewer than three people
  used is folded for a reader without `usage.read_people`** (D-087 item 7):
  in `by_agent` and `by_model`, every agent and every model used by fewer than
  three distinct people within the response's scope — the organisation, or the
  space, over the range — is summed, tokens, cache reads and cost alike, into
  one last row, `agent` (or `model`) `other`, with `few_people`, the number it
  holds; the client labels it *Other (fewer than 3 people)*. So no row, and no
  total less the listed rows, is one person's agent or model. A member and
  every token, an owner's included, get the fold; owners and admins on a web
  session get every row. `few_people` is absent on every other row.
  `top_tasks` are the ten that cost most, only tasks the reader may read.
  `no_token_data` names the agents people here
  connect (§9.3's `last_client` on a live token) that keep no token count the
  collector reads — Copilot CLI, Cursor and Windsurf among them; Omnigent and
  Hermes run one of the others and are not listed.
- `GET /users/:id/usage` — one person's tokens over this week and the eleven
  before it (Monday-start, UTC weeks; tomorrow's day from a machine ahead of
  UTC counts in this week): `{ user_id, from, to, weeks: [{ start, tokens,
  cache_read }], totals, by_agent, by_model, no_token_data, sharing: {
  org_enabled, enabled } }`. Their own (`usage.read_own`), or anyone's for an
  owner or admin (`usage.read_people`); **web session only**, so every token
  is refused `session_required`, the person's own included. Permission is
  asked before the person is looked up. Their own tokens only: an automated
  session's rows are not in it (D-091).
- **Every read is one range of one index** (§4.13): the organisation's on
  `day`, a space's on `project_id`, a person's on `user_id`. Measured with 300
  people × 400 days (720,000 rows): each query under 30 ms at 90 days, a
  report's upsert 2–3 ms.
- Every figure is a floor — the session files miss an agent's background
  calls (D-084 item 9) — and the client says *at least*.

**The OpenTelemetry fallback (LAI-773, D-084 item 9, D-087).** `POST
/otlp/v1/metrics` takes Claude Code's own metrics as **OTLP/HTTP JSON**
(`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`) — a protobuf body is refused `422
protobuf_not_supported`, because Laika carries no protobuf decoder — with the
developer's own Laika token as the bearer header. Who is sending and both of
D-084's switches are asked in a middleware **before the body limit and before
any byte of the body is read**: signed out is `401`, a switch off `403
local_activity_off`, whatever the size of the body (review). A `read_only`
token is refused as for any report. Of the body only these metrics are read:
`claude_code.token.usage` (attribute `type`: `input`, `output`, `cacheRead`,
`cacheCreation`; `model`; `session.id`) and `claude_code.cost.usage` (USD) —
and, since LAI-787, `claude_code.active_time.total` (seconds; attribute `type`:
`user`, time at the keyboard in Claude Code, or `cli`, the agent working;
`session.id`), kept per session key and day as agent minutes (§4.50) and never
added to a token row or a time entry; every other metric and attribute —
`user.email`, `organization.id`, the account ids, the terminal — is read past
and never stored, and `session.id`
is kept only as its one-way key (§4.38). A point without `session.id` cannot be
matched, so it is refused rather than risk counting twice. **A point is taken
only for the days a usage report may carry**: its interval must start no later
than it ends, and end within *today − 31* to *today + 1* in the zone the
person's usage reports state (§4.44). Any other — a timestamp past the last
instant a date can hold included — is refused in `partialSuccess` as
`day_out_of_range`, before it is stored or can move a series, so a far-future
point cannot block the delta points after it. Each point's day is the day its
interval ended in that zone. Both temporalities are taken without double
counting (§4.39). It answers OTLP's own response,
`200 {}`, or `{ "partialSuccess": { "rejectedDataPoints": n, "errorMessage" }
}`; body limit 256 KiB; its own rate bucket (§6.3). **It is not presence**
(D-081 excludes this path): an open session exports all day, idle or not.
**`/otlp/v1/logs` and `/otlp/v1/traces` answer `404` without reading the
body** — they are the exporters that can carry prompt text — and Laika makes
no call out (§13.4). Telemetry fills only the gap the files leave (§4.38), as
Claude Code's, unattributed: it has no task signal. Verified against
code.claude.com/docs/en/monitoring-usage on 2026-10-18 — the variable names,
`http/json`, the two metrics and their attributes, `session.id` on by default
(`OTEL_METRICS_INCLUDE_SESSION_ID`), and the temporality default `delta` with
`cumulative` allowed. **Not confirmed there**: whether `session.id` arrives
on the data point or the resource, so both are read. **`laika activity on`
sets it up** (LAI-867), once per laptop, in `~/.claude/settings.json` — which
every Claude Code reads, one started from the Dock and Omnigent's SDK sessions
(`--setting-sources=user,project`) included — so no shell-profile line is
needed. It writes six non-secret variables into `env` and a top-level
`otelHeadersHelper`, a 0700 script that reads `LAIKA_TOKEN` from
`~/.laika/env` each time it runs and prints the header as JSON; **the token is
never written**, into settings.json or the script. It backs up first by the
`.bak` rule, keeps the file's mode, leaves a key the person set to another
value and says so, and a second `on` writes nothing. `laika activity off`
removes only what `on` added, each key only while it still holds `on`'s
value; `laika activity status` probes this endpoint with a body carrying no
metric and says whether telemetry reaches the board. Connect shows the same
settings:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": "$LAIKA_URL/api/v1/otlp/v1/metrics",
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "cumulative",
    "OTEL_LOGS_EXPORTER": "none"
  },
  "otelHeadersHelper": "~/.laika/otel-headers"
}
```

`laika activity otel` still prints them as `export` lines, with
`OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer $LAIKA_TOKEN"`, for
whoever wants them by hand.

**API-equivalent cost (D-084 item 10, LAI-773)** — what the tokens would cost
at list price on the vendor's API, priced per model by §4.35, **labelled
*API-equivalent, not your bill* wherever it is shown**. Every cost is `{ usd,
unpriced_tokens, unpriced_models, unconfirmed_models }`: dollars over the priced
models, the headline tokens of models with no price beside them (never priced
at zero), and the priced models whose price was inferred. `GET /usage` adds
`totals.cost`, `org_totals.cost`, `by_model[].cost` (a number, or `null` with no
price), `by_developer[].cost` (only where `by_developer` is served — owners and
admins on a session), `by_project[].cost` (the organisation only, LAI-814),
and:

- `telemetry` — `{ tokens, cost_usd_reported }`: what OpenTelemetry added over
  the files in the range, and Claude Code's own cost figure for the
  telemetered sessions for a reader of the organisation's figures; `null` for
  a space, which telemetry cannot reach (it ties to no task).
- `cache` — `{ share, saving_usd }`: of every input-side token (input, cache
  writes, cache reads) the share read from the cache, and what those reads
  saved against fresh input at list price; `cache_by_project` the same per
  project the reader may read, in name order, `{ project, cache_read,
  input_side, share, saving_usd }`.
- `accepted` — `{ by_project: [{ project, tasks, tokens, cost, cost_per_task
  }], by_agent: [{ agent, tasks, people, tokens, cost, cost_per_task,
  few_people? }], agents_withheld }`: the tasks accepted in the range (§4.27)
  and everything tied to them, build and rework, priced — the cost of one
  accepted task per project and per agent. **For a reader without
  `usage.read_people`, an agent fewer than three people spent tokens on those
  tasks with is folded** (D-087 item 7, D-085 item 8's rule: with fewer, an
  agent's figure is a person's) into one last `by_agent` row, `agent:
  "other"`, with `few_people` — the agents it holds — its tasks and people
  counted once each, and its tokens and cost summed; `agents_withheld` is how
  many were folded. Folded, not dropped,
  so the card's total less the listed agents is no one person's spend. Owners
  and admins on a web session see every agent, and `agents_withheld` is 0.
  Never per person.
- `budgets` — each space's and sprint's budget in scope (§4.36), then the open
  tasks at 80% of theirs or more, fullest first, at most 20, as below.
- `runaway` — `[{ project, alerts }]` for a reader holding `usage.read_org`, and
  `null` for anyone else: runaway alerts per project, **counted once a day
  old**, so the assignee hears first — a count, never which task or whose, in
  project name order, never ranked.

`GET /users/:id/usage` adds `totals.cost` and `by_model[].cost`. `GET
/tasks/:id/usage` adds `totals.cost`, `by_person[].cost`, `budget` (below, or
`null`) and `runaway` — the open runaway alert on the task, `{ alert_id,
tokens, p95, since, last_progress_at }`, **only for the person it is
addressed to, on a web session**, else `null`.

**Budgets (LAI-773, §4.36).** A budget is `{ scope, id, project, label, title,
source, tokens, period, used, share, state, crossed }`: `source` is `set` by a
lead or, for a task, `forecast` — the p80 frozen at its claim; `period` the
days counted (`null` for a task, all its tokens); `state` `under`, `warn` (80%
or more) or `over` (100% or more); `crossed` the alerts raised under the budget
in force, `[{ threshold, at }]`. `GET /projects/:slug/budgets` answers `{
project_budget, sprints, tasks, can_set }` under `usage.read_project` — the
open tasks with a budget and any task a lead set one on — and the three `PUT`s
take `{ tokens }`, a whole number 1–10¹², or `null`, under §3.2's
`budget.set` (a lead, **session only**: an agent's token never moves its own
budget), answering `{ budget }`. **Soft**: nothing anywhere is refused for a
budget. After every usage report, and after a budget is set, each task the
report named — and its sprint and project — is checked, and an alert raised
once at 80% and once at 100% (§4.37).

**The runaway-agent alert (LAI-773).** After every usage report, each task it
named is checked: **in progress, with an assignee, on its first build** (no
finished round — the forecast is for the build), whose tokens pass the **p95**
of the forecast frozen at its claim, `p50 · (p80/p50)^(z95/z80)` — the frozen
range read as the log-normal it is calibrated as — **while nothing has landed
for an hour**: no claim, no push GitHub reported for the task (`webhook.commit`,
D-083), no commit key from the assignee's machine (§4.24), and no session
**arriving** on it — the first heartbeat after five minutes' silence. **A
heartbeat is presence, not progress**: it carries a repo and a branch (D-005),
and an agent looping through tool calls heartbeats as steadily as one doing
good work. The hour is measured, not chosen: on this repository's history, 581
gaps between consecutive commits of one task within a sitting are p90 31 and
p95 47 minutes, and sixty is six sync intervals, so one late sync never
raises it. One alert per stall, **addressed to the assignee alone**.

**A person's alerts.** `GET /me/token-alerts` answers `{ alerts: [{ id, kind,
scope, threshold, tokens, limit_tokens, created_at, project, task, sprint }] }`
— the caller's own, newest first, at most 50: runaway alerts addressed to them
on work they still hold that nothing has moved on since; budget alerts on open
tasks they hold; and, where they may set budgets, their projects' sprint and
this month's project budget alerts — each only under the budget still in
force. `POST /me/token-alerts/:id/dismiss` puts one away for the caller only
(`204`; `404` for one they are not shown). Both **session only**
(`token_alerts.own`).

**The plan-limit forecast (D-087).** `GET /me/plan-limit` answers `{ plan,
window, limit_tokens, week_reset, tz, used, rate_per_hour, window_start,
window_end, reaches_limit_at, reached, estimate: true }` — **the developer's
own and nobody else's**: `plan_limit.own` is session only, no endpoint reads
another person's, and no token reads it, the person's own included. `PUT` takes
`{ plan, window, limit_tokens, tz, week_reset? }` — `plan` a label (§4.41),
`window` `5h` (rolling), `day` or `week`, `week_reset` `{ weekday, minute }`
exactly for a week — and `DELETE` clears it. `used` is the headline tokens
that reached the board in the window (§4.42), `rate_per_hour` the last hour's,
and `reaches_limit_at` when `used` reaches the limit at that rate — `null` with
no rate, once reached, or past the window's reset. **No plan carries a token
figure**: Anthropic states its plans' limits as a session that resets every
five hours and a weekly limit at a fixed time (support.claude.com, *What is
the Max plan?*), not in tokens, so the number is always the developer's.

**Time (D-088, LAI-787).** Everything here is the caller's own and no
parameter names anybody else.

- **The switches.** `GET /me/time-settings` answers `{ org_mode, draft_my_time,
  drafting, min_sync_interval_s, signal_times, folder_names, breaks, place }`
  to a session or any token of the person's — a collector asks before it sends.
  `signal_times: true` says the board takes a block's `at` (D-096), and
  `folder_names: true` that it takes a block's `folder` and `branch` (D-098
  item 6); a collector sends each only then, so a board that predates it is
  never refused an upload over it. `PUT /me/time-settings` takes
  `{ draft_my_time }`, `{ place }` or both from a web session only — `place`
  an IANA zone id of at most 64 characters, or `null` to forget it (D-106);
  an empty body is `422`. Off deletes every draft the person has not
  confirmed. `PUT /org/time` takes `{ mode }` — `off`, `manual`
  or `drafts` — from an owner or admin on a web session (`org.time.set`);
  leaving `drafts` deletes everybody's unconfirmed drafts. A confirmed draft
  stays, its evidence blanked (§4.45), and entries are never deleted by a
  switch. `PUT /org/time/breaks` takes `{ breaks: [{ label, start, end, days
  }] }` from the same people on the same terms (`org.time.set`, D-101): at
  most eight windows, a label of 1–40 characters, `start` and `end` as
  `HH:MM` with start before end, `days` a non-empty list of unique ISO days
  1–7, and no two windows overlapping on a day they share; a broken rule is
  `422` with an issue naming the window (`breaks.N…`). An empty list clears
  the schedule; with no §4.45 row yet one is made with `mode: off`. It answers
  the caller's time settings, and writes nothing else — no draft, entry or
  break. `breaks` in the answer above is that schedule, `[]` when there is
  none: wall-clock windows on each person's own day, display only.
- **A collector's upload.** `PUT /me/time-drafts` takes `{ v: 1, collector_id,
  tz, days: [{ day, blocks: [{ start, end, minutes, task, signals, at?,
  folder?, branch? }] }] }` —
  `start` and `end` unix ms, `task` a key or `null`, `signals` the counts
  `{ prompts?, replies?, sessions?, commits?, marks? }`, `at` which five
  minutes the block's prompts and commits fell in, `{ prompts?, commits? }`,
  each a list of `[bucket, count]` pairs, a bucket `floor(unix ms / 300000)`,
  a count at least 1 (D-096, LAI-834), `folder` the name the person gave the
  block's work folder on their machine and `branch` that folder's branch,
  sent only when they turned it on (D-098) — and nothing else: any other field,
  here or in a block, is `422`. A `folder` is 1–60 characters with no `/`,
  `\`, control or format character, and a `branch` `[A-Za-z0-9._/-]`, 1–255,
  only beside a `folder` (`invalid_blocks`). **An untied block with a `folder`
  goes under the project it matches**: of the live projects the person may
  read (`project.read`), the one whose `slug` is the name in lower case, else
  the one — and only one — whose `name` is the name, case and outer spaces
  aside. Two that match by name, or none, and the block stays untied: the
  board never guesses. A block whose key names a card the person can read
  keeps that card's project. A kind's buckets are in order, each once, inside
  the block — its last minute included — and count no more than the block's
  count of that kind (`invalid_blocks`). My day serves them back as
  `signal_times`, `{ prompts, commits }`, each `[bucket start in unix ms,
  count]` in order: every block of the day, whatever became of it, a bucket two
  blocks share counted once at its largest — the SIGNALS lane, to the person
  alone, signed in. Days run from today − 14 to
  today + 1 in `tz`, at most 15, each once (`day_out_of_range`); a day holds at
  most 48 blocks, each starting on its own day, ending after it starts, with no
  more minutes than its span, and 1440 minutes in all (`invalid_blocks`). It
  replaces the caller's unheld pending blocks from that collector for each day
  and measures each new block against what is settled, by origin (§4.47).
  Refused `403
  time_drafts_off` — before the body is read — unless both switches are on.
  Body limit 16 KiB; its own bucket under §6.3's collector policy. Answers
  `{ accepted_days, stored_blocks }`.
- **An agent's proposal.** `POST /me/time-drafts` takes `{ minutes, task?,
  day?, tz?, note? }`, stores a draft with `source: "agent"` — never an entry —
  and answers `201` with `{ id, minutes, day }` and nothing more: a token reads
  no draft, its own proposal included. The same rules and switches as §7.1's
  `propose_time_entry`, its twin.
- **My day.** `GET /me/time?day=&tz=` answers `{ day, tz, today, settings,
  drafts, entries, breaks, drafts_held, agent, state, week, timer, day_note }`: the pending
  drafts and live entries of the day in the order they happened, each with
  its task `{ id, key, title }` and project `{ id, slug, name }` and its work
  folder's chosen name and branch, `folder` and `branch`, or `null` (D-098) —
  a draft's for the person alone, an entry's as confirmed; `breaks` —
  the gaps the person waved away that day (§4.55), each `{ id, day, tz,
  started_at, ended_at }`, in the order they happened, **never counted as
  time**; `drafts_held` — `{ count, minutes }` of the person's pending drafts
  on every day, so the page can say what turning *Draft my time* off deletes
  before it asks (LAI-831, CHIEF's addition F; dismissed drafts go too and are
  not counted); `agent` — `{ minutes, keyboard_minutes, by_task: [{ task,
  minutes }], unattributed_minutes }`, **agent minutes, never hours**;
  `state` — `drafted`, `confirmed`, `no_signal` (nothing reached Laika: never
  shown as zero hours) or `future`; and `week`, Monday to Sunday, each
  `{ day, confirmed_minutes, drafted_minutes, state }`; and `timer` — the
  person's running timer (§4.61), `{ started_at, resumed_at, paused_at,
  accumulated_ms, tz, task, kind, title }`, whatever day is open, or `null`;
  and `day_note` — the person's note on the day (§4.62), `{ day, note,
  updated_at }`, or `null`.
  Without `tz`, the zone of the person's drafts; without `day`, today there.
  One indexed query per section.
- **A stretch of days (LAI-526).** `GET /me/time/summary?from=&to=` answers
  `{ from, to, days, active_days, confirmed_minutes, drafted_minutes,
  meeting_minutes, manual_minutes, by_day, by_project, by_task, by_kind }`
  over the days `from` to `to`, both kept — at most 92 (`422 range_too_long`),
  never backwards (`422 range_backwards`): confirmed entries and pending
  drafts, **read day by day with `GET /me/time`'s own readers**, so a task the
  reader cannot read is named here no more than there. `by_day` is every day
  of the stretch `{ day, confirmed_minutes, drafted_minutes }`; `by_project`
  and `by_task` `{ project | task, confirmed_minutes, drafted_minutes }`,
  largest first, `null` for time on none — a task row also carries its
  `project` and `untied`, true for drafted time nobody has put on anything
  yet, kept apart from time typed on no task; `by_kind` `{ kind, minutes }`,
  `null` for time nobody named. `meeting_minutes` is confirmed time of the
  meeting kind; `manual_minutes` confirmed time typed or run on a timer. Under
  `GET /me/time`'s actions; `GET /people/:id/time/summary` is the same answer
  for a reader holding `people.analytics.read`, logged as a look with no day.
- **The timer (§4.61, LAI-500).** `POST /me/time/timer` `{ tz, task?, kind?,
  title? }` starts the person's one timer, `201`; a second start is `409
  timer_running`. `POST …/pause` banks the running segment (`409 timer_paused`
  when paused already); `POST …/resume` opens a new one (`409 timer_running`
  when running); `DELETE /me/time/timer` discards it, `204`; each is `404
  no_timer` with none. `POST …/stop` writes the entry as §4.61 says and
  answers `201 { entry, crossed_midnight }` with the entry's `X-Undo-Id`. All
  session only, behind `time_entries.write_own`.
- **The person's hands.** `PATCH /me/time-drafts/:id` puts a block on a card
  (`task`), a project (`project`) or *General* (`general: true`), changes its
  minutes, moves its edges — `started_at`, `ended_at`, unix ms, My day's
  drag and −/+ (LAI-831) — or changes or clears its work folder's name and
  branch (`folder`, `branch`, D-098 item 5; clearing the name clears the
  branch, and a branch with no name is `422 branch_without_folder`), and holds
  it for them so no sync overwrites it. Confirming carries the name and branch
  into the entry (§4.48).
  Refused `422` for an edge on a block with no span (`no_span`), a span that
  does not end after it starts (`invalid_span`) or leaves the block's day in
  its zone (`outside_day` — never moved to the next day), and a timed block
  given more minutes than its span (`minutes_over_span`). `…/split` `{ at }`
  cuts one at a minute inside it into two, each with its share; `…/dismiss`
  puts it away for good, but for Undo; `…/confirm` makes it an entry (`201`);
  `…/confirm` takes an optional `{ kind?, title?, description? }` — what the
  block was, said at the confirm (D-110), written onto the entry; left out,
  the entry carries nulls as before.
  `POST /me/time/days/:day/confirm` confirms the day's pending drafts in one
  transaction, an untied one as *General*, answering `{ entries, day_note }`;
  its optional body `{ note? }` is the person's note on the day (§4.62,
  D-110 item 2), written in the same transaction — so a day the clock refuses
  keeps no note — and left in place by Undo. `PUT /me/time/days/:day/note`
  `{ note }` sets the note alone, 500 characters, trimmed; `null` or nothing
  but spaces removes it; answers `{ day_note }`. A block
  has **one entry for as long as it is kept**: confirmed again after Undo
  took its entry back, the same entry is live again as its next `edited`
  revision, never a second (`source_ref`, §4.48).
  `POST /me/time-entries` is time typed by hand — a meeting, a call — needing
  only the organisation's *Time* not `off` (`403 time_off`). `PATCH` and
  `DELETE /me/time-entries/:id` write the next revision — except on an entry
  imported from Solidtime, which is changed there and refused here `403
  imported_entry` (LAI-788); `GET …/revisions`
  answers `{ revisions }`, oldest first. `PATCH` also takes `started_at` and
  `ended_at` (LAI-831), moving an entry's edges on its own day as **one
  revision**, however far a drag went: an entry with no set time takes both at
  once (`422 no_span`), a new `day` and a new span are two edits
  (`422 invalid_span`), and the span is held to its day and its minutes as a
  draft's is (`invalid_span`, `outside_day`, `minutes_over_span`). A day holds
  at most 1440 minutes of a person's live entries (`422 day_full`). All of
  these are **session only**: no token reads, confirms or writes a person's
  time.
- **Time recorded at the same time is allowed** (LAI-528, D-113). A
  person's confirmed entries may overlap one another — agents working in
  parallel, a meeting beside them — so a confirm, *Confirm day*, a timed
  entry's create, an edit of a timed entry's span or minutes, a timer's stop
  and an entry Undo brings back are **never refused for overlapping confirmed
  time**. This retires LAI-831 review round 2's clock rule (a stretch of
  overlapping entries held to its wall clock, `409 overlaps_confirmed`) and
  D-112 item 4's refusal of a draft's confirm over confirmed time; neither the
  code nor the reason exists any more. What still holds: a block keeps no
  more minutes than its own span (`422 minutes_over_span`, on a draft's new
  span or minutes and a timed entry's create or edit) and a person's live
  entries on a day sum to at most 1440 minutes (`422 day_full`, on every
  write, *Confirm day* all or nothing). Overlapping entries each count their
  own minutes, so a day's total may exceed the hours its clock covers.
- **Undo (LAI-831, CHIEF's addition B).** Every change My day can take back
  answers with an `X-Undo-Id` header naming **that change**: `PATCH
  /me/time-drafts/:id`, `…/split`, `…/dismiss`, `…/confirm`, `POST
  /me/time/days/:day/confirm` when it confirmed anything, `POST
  /me/time-entries` and `DELETE /me/time-entries/:id` — not `PATCH
  /me/time-entries/:id`. `POST /me/time/undo` takes `{ id }`, that id, and
  puts back exactly what the change replaced, from what it recorded (§4.56)
  and never from what the page saw, answering `204`: a confirm or *Confirm
  day* — its entries taken back, every block pending as it stood, its
  collector's or held; *General*, a card, minutes or an edge — the block as
  it stood; *Not work* — pending again; a split — the halves gone and the
  block back under its own id; an add — the entry taken back; a delete — the
  entry live again. **History stays append-only**: an entry taken back is a
  `deleted` revision and one brought back an `edited` one (§4.49). Refused
  `409 changed_since` when anything the change wrote has changed since, and
  `409 newer_change` when a later change touched any draft or entry it wrote
  — that one comes off first, by its own id, so changes come off newest
  first, as a stack; `404` for a change older than two minutes
  (`UNDO_WINDOW_MS`), already undone, or anybody else's. An entry brought back
  is judged as any other (`422 day_full`). Nothing
  is undone on a refusal. Needs `time_drafts.manage_own` and
  `time_entries.write_own`, and the organisation's *Time* not `off` (`403
  time_off`).
- **Breaks (LAI-831, CHIEF's addition D).** `POST /me/time-breaks` takes
  `{ day, tz, started_at, ended_at }` and nothing else — a gap on the
  person's own day, waved away — and answers `201` with `{ id, day, tz,
  started_at, ended_at }`. The day is one an entry could be on (`422
  day_out_of_range`, today − 365 to today + 1 in `tz`; `422 invalid_tz`); the
  span ends after it starts and stays on that day (`422 invalid_span`, `422
  outside_day`), overlaps no break already there (`422 overlaps_break`), and
  a day holds at most 48 (`422 too_many_breaks`); and it needs the
  organisation's *Time* not `off` (`403 time_off`). `DELETE
  /me/time-breaks/:id` removes one, `204`, and the gap counts again; anybody
  else's is `404`. **A break is never time**: it touches no draft and no
  entry, and no total reads it. Both under `time_drafts.manage_own`, session
  only (§4.55).
  Since D-108 (LAI-897) a typed entry may say **what it was**: a `kind` from
  §4.48's list, a `title` of up to 120 characters and a `description` of up
  to 2000, on a card or on none; `PATCH` takes each, `null` clearing it. A
  span sent with a create is held to its own day (`422 outside_day`), as an
  edit's always was. The web app asks for a title only when there is no
  card; the server does not.

**The Solidtime bridge (D-088 items 6 and 10, LAI-788).** The board never
calls Solidtime: the person's CLI does, with their own Solidtime key kept on
their machine, and tells the board what it did. Every route is **session
only** — the CLI signs in for the run and keeps no session.

- **The outbox.** `GET /me/time/solidtime?since=` answers `{ closed_through,
  push, held, projects, taken }`. Each `push` item is `{ entry_id, revision,
  action, day, tz, started_at, offset_minutes, minutes, task, project,
  solidtime_project_id, note, moved, solidtime }`: `create` for a confirmed or
  typed entry (`draft`, `manual` — never `import`, never agent minutes) on or
  after `since` that Solidtime has not got; `update` for one it has that
  changed in Laika since they last agreed; `delete` for one deleted in Laika.
  `solidtime` is `{ id, hash, started_at }` as Laika last saw it, for the CLI
  to compare before it writes; `moved` says an update's card or space changed
  in Laika, the only time the CLI may change Solidtime's project and
  description. A timeless entry starts at 09:00 local plus `offset_minutes`,
  the day's earlier timeless minutes. `held` is
  `{ entry_id, day, reason }`: `closed_period`, `space_not_mapped` or
  `space_has_several_projects`. `projects` is each space's push target,
  `{ space, space_id, solidtime_project_id }`. `taken` is the Solidtime ids
  already twinned with the person's confirmed or typed entries near the days
  to create, which the CLI's duplicate check must never take for a new one.
- **Links.** `PUT /me/time/solidtime/links` takes `{ member_id, links:
  [{ entry_id, revision, solidtime_id, hash, started_at, removed? }] }` —
  what the CLI created, updated or deleted — and answers `{ linked, removed,
  retired }`; a Solidtime entry an admin's pull had already brought in as the
  person's import is that entry's duplicate, deleted (`retired`).
- **An import.** `PUT /me/time/solidtime/import` takes `{ v: 1, member_id,
  tz, from, to, complete, entries: [{ id, start, end, project_id, key, hash
  }] }` — unix ms, at most 92 days and 2000 entries, `key` a key read from the
  description or `null`, and **no field for the description**. An entry new to
  Laika becomes an `import` entry on the card its key names — never guessed,
  as §4.5's outside ids — else on its project's mapped space, else *General*;
  a different `hash` is an edit; with `complete`, an entry missing from the
  window is a delete. It answers `{ created, updated, deleted, unchanged,
  ignored, conflicts, flagged }`; `flagged` is `{ solidtime_id, day, reason }`
  — `closed_period`, `day_full`, `day_out_of_range`, `too_long` — never
  taken. Under half a minute is `ignored`. `409 member_linked_elsewhere` when
  an admin confirmed the member as somebody else.
- **Everyone's.** `PUT /org/time/solidtime/import` takes `members` — every
  member the batch carries, the only ones an absence can delete — and an
  entry's `member_id`; a confirmed member's time is theirs, dated on their
  own day (D-088 item 12) — in the zone of their latest confirmed or typed
  entry, else their drafts', else their activity reports', else the batch's
  `tz` — and anybody else's is kept as *people not on Laika*, in the batch's
  zone, and counted in `not_on_laika: { people, minutes }`. `GET /org/time/solidtime` answers `{ closed_through, projects,
  people, not_on_laika }`, the last with each member's minutes;
  `PUT …/projects` takes `{ projects: [{ solidtime_project_id, name, space,
  push? }] }` (`space: null` unmaps) and `PUT …/people` `{ people: [{
  solidtime_member_id, user_id }] }` (`user_id: null` undoes). Owners and
  admins only.

**API-equivalent prices.** `GET /org/model-prices` answers `{ as_of, can_set,
entries }` under `org.read` — every price in force, the organisation's first:
each entry §4.35's prices with `source` (a page, or `org`), `as_of`,
`confirmed`, `note`, `overridden`, and `table` (the code's row beneath an
override, or `null`). `PUT /org/model-prices/:model` takes `{ input, output,
cache_write, cache_read }`, USD per million, 0–10,000 each, and `DELETE` goes
back to the table; both `org.model_prices.set` (owners and admins, session
only), answering the same shape.

**A task's read shape is §4.5's columns** — `branch` and `external_ref`
included, which `TaskView` omitted until LAI-493 (LAI-286) — and `TaskView`
adds the fields below, which are not stored there — **derived at read time, so a reader who looks for them in §4 will
not find them and should not**. A slim list's task, `TaskSummaryView`, is the
same shape without `description_md` and `acceptance_md` (LAI-795):

| field | where it comes from |
| --- | --- |
| `key` | `project.key` + `number` — the display key an agent works in (§7) |
| `tags` | `task_tags` (§4.16), the whole set |
| `comment_count` | `comments`, excluding soft-deleted |
| `created_by_client` | the token's name, when a token created it (LAI-093). For a registered agent's token — named after the agent — it is served to the agent's owner only and is `null` for every other reader (D-120); a legacy token's name is unchanged |
| `status_name` | the `project_statuses.name` of `status_id` (§4.20) |
| `blocked_by`, `blocks` | **both directions of §4.6** — see §4.5. `ready` depends only on `blocked_by` |
| `send_back` | `{ reason_md, decided_by, created_at }` of the task's current send-back (§4.27), or `null` (D-082) |
| `size` | the estimate in force (§4.32): `{ level, computed, overridden, weight, build_p50_ms, build_p80_ms, subtasks }` — `level` is a person's size when one is set and `computed` is Laika's beside it — or `null` before one is computed (D-085) |
| `selected_agent` | §4.5's `selected_agent_id`, **served in its place**: `{ id, display_name, harness, device_label, status, owner: { id, name } }` of the agent the work is requested of (§4.63), or `null`; `display_name` is served to the agent's owner only and is `null` for every other reader (D-120) — never a token or a grant (LAI-535) |

`created_at` and `updated_at` are on every view and are not listed per endpoint.

**The review gate (D-082, LAI-758).** `POST /tasks/:id/finish` is
`finish_task`'s REST twin: the move to review, the summary comment and a new
round (§4.25) with its proof (§4.26), in one transaction. Every proof field is
optional, so a body with only `summary` and `checklist` behaves as before.
`commits` is `[{ sha, message? }]` — only the message's first line is kept —
`pull_request` an `http(s)` URL, and `tests` `[{ command, exit_code }]`; the
limits are §4.26's and a breach is `422` naming the field, with nothing moved.
`GET /tasks/:id/rounds` answers `{ rounds, send_back }`: each round as
`{ id, task_id, number, finished_by, client_name, agent, by_registered_agent,
summary_md, commits, branch, pull_request, tests, ci, created_at }`, each item
with `id`, `state`,
`state_source` and `state_at` beside its own fields (`sha` and `message`,
`name`, `url` and `merged`, `command` and `exit_code`), newest round first;
`project.read`. `pull_request.merged` is `true` or `false` once a GitHub
delivery named it, `null` before (D-083). `ci` is `{ head_sha, total, passed,
failed, pending, failed_names }` from §4.31, or `null` when no CI result was
reported for the round's head commit.

**Which agent finished a round (D-120, LAI-1001).** `agent` is `{ id,
harness, device_label }` for the registered agent whose token finished the
round, read through the round's token — **only when the reader may already see
that agent**: their own, or the task's selected agent or the holder of its live
claim (§4.63: another person's agent is not disclosed). Otherwise `agent` is
`null`, and `by_registered_agent` is `true` so a screen can say *an agent* and
name none. **`client_name` of a registered agent's round is its owner's
alone**: for a registered agent it carries its token's — its registered —
name, which under D-120 is never the label, so every other reader gets `null`,
even where `agent` is shown. For a person, a legacy token or a token since
deleted, `agent` is `null`, `by_registered_agent` is `false`, and `client_name`
is as stored. `GET /review` (§4.27) and `get_task_context`'s round carry the
same fields under the same rule; a caller with no user is shown no agent.
Org owners and admins reading a person's profile (`profile.read`, §6.4's profile `agents`) see that person's token names, registered agents included; this is access oversight, the one exception to D-120's owner-only name rule.
The estimate accuracy's per-client figures (`by_client`) count a registered
agent's round under its harness (`claude-code`), never its name; a legacy
token keeps its client name, and the three-person floor is unchanged.

**A task's tokens (D-084, LAI-770).** `GET /tasks/:id/usage?tz=` answers `{
task_id, key, tz, first_day, last_day, totals: { tokens, input, output,
cache_write, cache_read }, people, by_person, by_round, attributed }` under
§3.2's `usage.read_project`. Every person's rows for the task **add up** —
each person's collector sends its own tokens under the key, and attribution
follows who marked the task in their own session, never `assignee_id`.
`tokens` is input + output + cache writes, cache reads beside it (D-084 item
8). **Who sees whom is D-084 item 7**: `people` is `everyone` for a reader
holding `usage.read_people` (an owner or admin on a session), `own` for
anyone else on a session — `by_person` then holds only their own part, or
nothing — and `none` for a token, with `by_person: null`. `by_person` is `[{
user_id, name, tokens, cache_read, by_agent: [{ agent, tokens, cache_read }]
}]` in name order, never ranked. `by_round` is `[{ number, finished_on,
tokens, cache_read }]`: rows are per day, so a day counts toward the first
round handed in on or after it, read in `tz` (default `UTC`, `422
invalid_tz` otherwise) — a round's finish day counts toward that round — and
what comes after the last finish is the open round, `finished_on: null`.
`attributed` is `{ tokens, of }` — of everything the people this reader sees
spent on the days the task has tokens, the part tied to a task, this one or
another (D-084 item 6) — or `null` when they see nobody's. `totals`,
`first_day`, `last_day` and `by_round` hold every row tied to the task, those
marked `automated` included; `by_person` and `attributed` hold the people's own
rows only (D-091, §4.33), so `by_person` may sum to less than `totals`.

**Sizes and forecasts (D-085, LAI-771).** `POST /projects/:slug/tasks` and
`PATCH /tasks/:id` take an optional `size` — `XS` to `XL`, or `null` on `PATCH`
to go back to the computed one — under `task.write`, so anyone who may edit the
task may size it; anything else is `422`. A `size` that cannot be stored
refuses the whole `PATCH`, and nothing of it is saved — a person's size is their
write, not a derived figure. `GET /tasks/:id/estimate` answers `{ task_id, size,
why, override, at_start, actual, tokens, actual_tokens, claim_estimate,
scope_grew, split, history }` under `project.read`: `why` is
`{ early, method, typical: { words, build_ms }, factors: [{ key, label, levels
}], similar: [{ task_id, key, title, build_ms, similarity }], model_version,
computed_at }`; `override` is `{ level, set_by,
set_at }`; `at_start` is the frozen copy `{ level, build_p50_ms, build_p80_ms,
tokens_p50, tokens_p80, estimated_at }`; `actual` is `{ build_ms,
review_wait_ms, rework_ms, finishes, first_finish_at }`; `history` the latest
20 rows, newest first. LAI-772: `tokens` is the build-token forecast in force,
`{ p50, p80, learned_from, forecasts_after }` (both `null` until
`learned_from` reaches `forecasts_after`); `actual_tokens` is `{ build,
total, rework }` — build up to the first finish's UTC day, rework after — for
a reader holding `usage.read_project`, else `null`, and `null` with none tied
to the task; `claim_estimate` is `{ level, confidence }` or `null` — when it
was said and by which agent are kept (§4.34) and not served, since either ties
it to a person (LAI-772 review, N1); `scope_grew` is `{ from, to }` or `null`;
`split` is `{ xl_finished, rounds_avg }` for an XL task, else `null`.
`GET /projects/:slug/estimates/accuracy` answers `{ project_id, finished,
forecasts_after, live, backtest, by_client, tokens, agent, model_version }`:
`tokens` is `{ learned_from, forecasts_after, live, backtest }` for the token
forecast, `agent` is `{ size: { n, agent_error, median_error, model_error,
weight }, confidence: [{ confidence, n, sent_back }] }` (§4.34); `live` measures
frozen-at-claim forecasts against actual build times — `{ n, typical_error,
bias, p80_hit_rate }`, the error a ratio such as `1.7`; `backtest` is the
replay against the plain median, `{ n, method_error, median_error,
p80_hit_rate, beats_median }`, or `null` before there is one; `by_client` is
the same figures per agent client, **only where at least three distinct people
are behind the measured tasks it finished first** — not everyone who has used
it — with `people` as a count; a registered agent's round counts under its
**harness** (`claude-code`), never its registered name (D-120), and a legacy
token's under its client name. Nothing in either answer names or groups
by a person.

**The sprint forecast (LAI-772).** `GET /sprints/:id/forecast` answers, under
`project.read`, `{ sprint_id, total, done, forecast, reason, basis }`:
`forecast` is `{ probability, low, high, median, days_left }` — the central
range of tasks done by the end of `ends_on` left once the same number of the
2000 seeded draws is trimmed from each tail (at most 7.5% each), so it holds
at least 85% (trimmed evenly, not the narrowest such range); each day of the
days left is drawn from what the project finished per calendar day over the
last 42 days (size weight, quiet days included), the tasks left finished in
order (review, in progress, to do, backlog; board order within each) while
capacity lasts. `null` with `reason` `completed`, `no_tasks`, or
`not_enough_history` (fewer than 10 tasks done in the window); `basis` is
`{ days, tasks_done, weight_done }`. Cached per sprint against every input, so
a re-read with nothing changed draws nothing. Not story points: nothing in it
is typed by anybody.

**Offboarding asks (D-104 item 5, LAI-986).** Removing someone from a space
(`DELETE /projects/:slug/members/:userId`) and deactivating them (`PATCH
/users/:id { is_active: false }`) take `open_tasks`: `"unassign"`, or
`{ "reassign_to": "<user id>" }`. "Open" is not `done` and not `cancelled`;
the scope is that space for a removal and every space for a deactivation.
Without `open_tasks`, while they hold any, the answer is `409` with `details:
{ reason: "open_tasks", count, keys, hidden }` — `count` is every open task,
`keys` only those in spaces the caller can read, `hidden` the rest. A
reassignment must land on an active person, not the one leaving, who can hold
**every** task (LAI-962's rule); otherwise `422` with `details: { field:
"open_tasks.reassign_to", reason: "cannot_hold", tasks: [{ key, reason }],
hidden }` — `tasks` only those in spaces the caller can read, `hidden` the
rest, as the `409` (or `reason: "self"` / `"inactive"` / `"no_such_user"`),
and nothing changes.
Each moved task writes `task.assigned` with `payload.via: "offboarding"`.
Deactivation also removes every space membership, one `member.removed` per
space with `payload.via: "deactivation"`; reactivating restores none. All of
it is one transaction with the removal or deactivation itself.

**The organisation's pulse (LAI-986).** `GET /org/overview` answers `{ people:
{ active, seen_this_week, since }, tasks: { open, in_review, blocked, overdue }
}`. `seen_this_week` counts active people whose `last_seen_at` (§6.4's
`UserView`) is at or after `since`, seven days before now. The task figures
are `GET /tasks/summary`'s, unfiltered, for the same caller (LAI-974): only
spaces the caller can read, `open` being every category but `done` and
`cancelled`.

**The GitHub webhook secret (LAI-753).** `GET /org` carries `github_webhook:
{ configured, payload_url }` for a caller who may *Configure webhooks* (§3.1,
session only) — absent, not null, for anyone else, as `ai` is.
`payload_url` is `LAIKA_PUBLIC_URL` + `/webhooks/github`, or `null` when the
server has none. `POST /org/github-webhook` takes no body: Laika makes a new
secret (32 random bytes, hex), stores it encrypted under its own purpose
(§12), and answers `201 { configured, payload_url, secret }` — **the only time
the secret is ever served**. Calling it again rotates: the old secret is
refused from that moment. `DELETE /org/github-webhook` clears it and answers
`204`; every delivery is then refused `401`. Both refuse a token `403` with
`details.reason: "session_required"`: whoever holds the secret can sign
deliveries that confirm an agent's proof (D-083).

**The history export (LAI-984).** `GET /activity/history?format=csv` is the
JSON answer's rows — same gate, same filters, same validation, newest first —
as one `text/csv; charset=utf-8` attachment named `laika-history-<date>.csv`,
streamed rather than paged, so `limit` and `cursor` beside it are `400`. A
refusal or a bad filter is the ordinary JSON error, before the file starts.
Columns, in order: `created_at` (ISO 8601, UTC), `created_at_ms`, `seq`, `id`,
`type`, `actor_kind`, `actor_id`, `actor_name`, `actor_token_id`,
`project_id`, `project_slug`, `task_id`, `payload` (the row's payload as
JSON). RFC 4180: a field with a comma, quote, CR or LF is quoted and its
quotes doubled; lines end CRLF; a text field starting `=`, `+`, `-`, `@`, tab
or CR is prefixed `'`, so a spreadsheet does not run it. `member.added`,
`member.role_changed` and `member.removed` rows name their subject:
`payload.user_name` beside `user_id`, with `from`/`to` (a role change) or
`role` / `org_role` as before.

`GET /review` answers `{ tasks, truncated }`: every task in a `review`
status on every project where the caller holds `task.write`, **oldest waiting
first** — waiting since its latest move into review from another category —
at most 200, `truncated` saying when more wait. Each entry is `{ task,
project: { id, slug, name, prefix }, assignee_name, waiting_since, round,
finished_by_name, can_decide, cue }`, `round` the latest (or `null`) and
`can_decide` whether this caller may accept or send it back. `cue` is
`{ kind: 'fast', build_ms, forecast_p50_ms }` — *"check this one"* (LAI-772)
— when round 1 finished in under 0.25× the build-time p50 frozen at the start
and CI has not confirmed the round (failed or still running is not
confirmed), else `null`. The p50 is Laika's own, before any claimant's size
was blended in, so a claimant's small size cannot hide a fast finish. A later
round, and a task started before its project had hours, never carry one.
About the task, never the person. Not paginated: it is the work waiting for a
person.

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
Requests made with a token are keyed by that token, so a session's stored answer
is never found by a token (LAI-534). As a second lock, for a review decision,
and for any stored task in a done category, the route runs instead and answers
the token itself.

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

**Every tool that takes a task takes its key, its id, or the outside id it
carries** (`external_ref`, §4.5, LAI-780) — `task`, `parent`, `blocked_by` and
`discovered_from` alike. A board key always wins. An outside id resolves only
among the projects the caller may read, so one on a task they cannot see is
`not_found`, as a key that names nothing is; one that two readable tasks
carry is refused `422` with `details.reason: 'ambiguous'` and the keys it
matched.

### 7.1 Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `laika_whoami` | `{}` | the identity this token acts as — `user_id`, `name`, `email`, `org_role`, `token_scope`, `agent` (the registered agent this token is the credential of — `id`, `display_name`, `harness`, `device_label`, `status` — or `null` for a legacy token; D-114) — and `how_to_work`, the same text as the server's `instructions`, for clients that drop those (D-076). Reads nothing, changes nothing |
| `list_projects` | `{}` | projects the user can read |
| `list_ready_tasks` | `{ project?, limit? }` | ready tasks exactly as §4.5 derives them — **unassigned** and unblocked — sorted p1→p3 then age. On a registered agent's token, also `work_requests`: its open work requests, ready or not, newest first, under the same `project` and `limit`, as `GET /agents/me/work-requests?project=&limit=` answers (LAI-535) — a request, not a claim |
| `get_task_context` | `{ task }` | **`send_back` first** — the reason a person sent it back, who and when, or `null` (D-082) — then task, description, `evidence` (the latest round's proof, each item with its state — `claimed`, `confirmed` or `failed` — and the CI line, or `null`; D-083) and `rounds` (how many), `blocked_by` + their statuses, comments (each with `sent_back`), recent activity, branch, `discovered_from` chain, `parent` (or `null`), `subtasks` with key, title, status and assignee, `subtasks_done` and `subtasks_total` (`total` excludes `cancelled`), and `estimate` — the size, its *why*, the forecast frozen at start and the actual, as `GET /tasks/:id/estimate` answers (D-085), with the token forecast, what was said at claim, *scope grew* and the split suggestion (LAI-772) — and `similar`: up to five similar finished tasks in the project, closest first, each `{ task_id, key, title, status, similarity, rounds, send_backs: [{ round, reason }] }` — why it was sent back, and nobody's name |
| `get_project_context` | `{ project, since_revision?, session_id? }` | `context_md` with its `revision` — or, with `since_revision`, **no document**: `context_diff` from that revision to the current one (§6.4's diff, truncated past 2,000 changed lines with the same `hint`) — its recent edit history, open-task summary, members + roles, and `before_you_start`: mark the task before starting (`start_working` with the `branch`, or `update_status` to `in_progress`) and name the branch `<PREFIX>-42-…`, because that is how a session's tokens reach a task (LAI-770). `session_id` is a registered agent's own open session: the revision answered is recorded as **delivered** to it (§4.69) — but not by a truncated diff, which sent none of it |
| `list_sprints` | `{ project }` | every sprint on the project, oldest first — id, name, dates, `status`, and task counts by status |
| `list_members` | `{ project }` | who is on the project — `user_id`, `name`, `email`, `role`. Where an assignee comes from |
| `create_task` | `{ project, title, description?, acceptance?, priority?, tags?, assignee?, sprint?, blocked_by?, discovered_from?, parent?, due_on?, planned_start?, size?, external_ref? }` | created task, `created_via: 'mcp'`. `parent` is a task ref and makes this a subtask, one level only. `external_ref` is an outside id (§4.5). `blocked_by` is resolved before anything is created: a blocker that is ambiguous or names no task refuses the call, and no task is filed |
| `update_task` | `{ task, title?, description?, acceptance?, priority?, tags?, assignee?, sprint?, parent?, due_on?, planned_start?, size?, external_ref?, agent?, claim_generation? }` | task. Every field optional; an omitted one is left alone; `null` on `parent`, a date, `size`, `external_ref` or `agent` clears it. **No `status`**. `size` (`XS`–`XL`) overrides the computed size (D-085). `agent` is a registered agent's id and is `PATCH`'s `selected_agent_id` (§6.4): a work request, never an assignment (LAI-535) |
| `start_working` | `{ task, branch?, estimate?, session_id?, reclaim? }` | task, or `409` with the current assignee. A `branch` is kept on the task (LAI-770). `estimate` is the claimant's own `{ size?, confidence? }` — `XS`–`XL` and `green` \| `yellow` \| `red` — kept in §4.34, scored against what happens, and blended into the forecast only once estimates here beat the project median (LAI-772); a resume keeps none. **The holder's own call on a task already in progress succeeds** as a no-op that keeps the branch it is given and returns the task — no status change, no `activity` row, `started_at` and the frozen estimate untouched — so a session resuming its task can mark it (LAI-770 review, B2); anyone else, and a holder whose task is not in progress, still get `409`. **On a registered agent's token** it also takes the task's exclusive claim (§5, §4.66) and answers `claim` — `{ session_id, generation, lease_expires_at, … }` — beside the task, and **never writes the assignee** (§5); `session_id?` names the session to claim under (absent opens one), and the holder's session calling again renews the lease. A second session — the same agent's, or another agent of the same person — is `409`, `reason: claim_held`. **A task with a selected agent** (§4.5) is claimed only by that agent's sessions — another agent is `409`, `reason: selected_for_another_agent`, with or without `reclaim` (D-119, §6.3). **`reclaim: true`** is the explicit reclaim, `POST /tasks/:id/claim/reclaim`'s twin (§9.1, LAI-541): only it gives an agent whose claim expired a claim again, at `generation + 1` |
| `update_status` | `{ task, status, note?, claim_generation? }` | task; validated transition. `status` is a category or a project status's name, case-insensitively (§4.20) |
| `set_task_sprint` | `{ task, sprint, claim_generation? }` | task. `sprint: null` takes it out of whichever it is in |
| `add_comment` | `{ task, body }` | comment |
| `finish_task` | `{ task, summary, checklist?, commits?, branch?, pull_request?, tests?, claim_generation? }` | task → **`review`**, summary posted as a comment, and a round with the proof, each item `claimed` until GitHub's deliveries confirm it (§4.25, D-082, D-083). Releases the session's claim (§5) |
| `create_sprint` | `{ project, name, goal?, start_date, end_date, status? }` | created sprint, with the id the other sprint tools take |
| `update_sprint` | `{ sprint, name?, goal?, start_date?, end_date?, status? }` | sprint. Completing one **does not move its tasks** (§4.15, D-013) |
| `update_project_context` | `{ project, context_md, mode, base_revision? }` | the document's new revision and length. `mode` is `replace` or `append`. `replace` must name the `base_revision` it replaces (absent is `422`, after the permission check); a stale one is `conflict`, `reason: stale_context_revision`, and nothing changes. `append` is computed from the current document inside the write, so two appends both land (LAI-555) |
| `log_unlisted_work` | `{ repo, note }` | records work or an idea outside any project, for triage |
| `propose_time_entry` | `{ minutes, task?, day?, note? }` | a draft in the person's own drafts (`source: 'agent'`, §4.47) — **never an entry**: only the person confirms it, signed in to the web app (D-088 item 13). Refused `forbidden` with `details.reason: "time_drafts_off"` unless the organisation's *Time* is `drafts` and the person turned on *Draft my time*. `day` is their local day, by default today in their drafts' zone. It answers `{ id, minutes, day }` and nothing of the person's drafts. Its REST twin is `POST /me/time-drafts` (LAI-787) |
| `agent_sync` | `{ project? }` | a registered agent's inbox: its **live** work requests and the hand-off and recovery offers it may accept, newest first — `GET /agents/me/inbox`'s twin (§6.4, LAI-546). Any other token is `forbidden`, `reason: not_an_agent`. Phase 4 adds delivery states; this reads, and records nothing |
| `checkpoint_task` | `{ task, id, idempotency_key, repo, branch, commit_sha, manifest, summary?, summary_commit_sha?, claim_generation }` | the checkpoint, `verification: 'pending'` until a signed push delivery verifies it — `POST /tasks/:id/checkpoints`'s twin (§4.70, LAI-545). Register **after** the push; the server never fetches anything (D-083) |
| `offer_handoff` | `{ task, to_agent, checkpoint, reason, idempotency_key, claim_generation }` | the offer, `open` or `pending_approval`; the caller's claim is `paused` — `POST /tasks/:id/handoff-offers`'s twin (§4.73, LAI-546). `to_agent` is an agent id |
| `respond_handoff` | `{ offer, action, verified_commit_sha?, reason?, session_id? }` | `action` is `accept`, `decline` or `cancel` — the twins of `POST /handoff-offers/:id/accept`, `/decline` and `/cancel` (LAI-546). `accept` needs `verified_commit_sha` and returns the offer, the new claim and its `generation`; approving is a person's and has no tool |

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
  single markdown field with no revision column. *(Superseded by LAI-555: an
  `append` is now computed inside the write, and §4.68 gives the document
  revisions.)*

### 7.2 Tool contract

- **Guardrail: tools never bulk-mutate.** One task per call.
- **`log_unlisted_work` is the one tool with no REST twin, deliberately** (D-024).
  Every other tool wraps a service a route also calls. Unlisted work is *by
  definition* something an agent noticed outside any project — a human at the
  board would file a task instead — so there is no human write path to mirror.
  Humans read it (`GET /api/v1/unlisted`) and act on it
  (`POST /api/v1/unlisted/:id/promote`). The parity tests of §13.3 therefore
  cover every other tool in §7.1, each against the route it wraps; this one is
  exempt, and **the exemption is named**, so the missing pair reads as intended
  rather than as a gap. *(This sentence carries no number: it said "nine … a
  missing tenth" until LAI-433 and "eighteen" until LAI-546, and each count went
  stale the day the surface changed. The guard holds the one exempt tool's name
  against its list instead.)*
- **`laika_whoami` has no twin of its own and is paired with `GET /api/v1/me`**,
  which answers the same question with more of it. It exists so an operator whose
  token is misbehaving can establish *who the board thinks they are* before
  debugging anything else — the first question, and the hardest to answer from a
  failing tool call. It writes no `activity` row, because it reads nothing.
- `finish_task` stops at `review` by design — agents do not close their own work.
  No tool reaches `done`: `update_status` refuses any done status to an agent
  (§5, D-082), and accepting is a person's, in the web app.
- **Every answer carries `context_revision`** (proposal §4.6, LAI-555): `{ project, revision, delivered_revision }` for the project the call named — by `project`, `task` or `sprint` — or `null` when it named none or one the caller cannot read. `delivered_revision` is §4.69's for the session the call named (`session_id`, or the claim `start_working` answers), else null. When that session is behind, one more text line of at most 300 characters says so — *"Project context changed: r12 → r14. Call get_project_context with since_revision: 12 for the diff."* — and **the document itself is never added**. A refusal is left as §6.3 shapes it, unstamped. Added once, where tools are registered, so a new tool carries it; a census over the registry proves it.
- **`claim_generation` is the claim fence's argument** (§6.3, LAI-541): every
  tool that changes a task — `update_task`, `update_status`, `finish_task`,
  `set_task_sprint`, `checkpoint_task`, `offer_handoff` — takes it, and it is REST's `X-Laika-Claim-Generation`
  set for that one call. A stale one is `conflict`, `reason: stale_claim`.
  `add_comment` does not take it: comments are never fenced. There are no
  session tools: an MCP-only agent renews by calling `start_working` again
  from its session, and a helper heartbeats over REST (`/agent-sessions`).
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
- **Every edit is an immutable revision** (§4.68, LAI-555). A write names the
  revision it replaces — `base_revision` on REST and on MCP's `replace` — and
  a write against any other is refused `409`, `reason:
  stale_context_revision`, with nothing changed. The history, any revision in
  full, and a diff between two are §6.4's reads; MCP asks for the diff with
  `get_project_context`'s `since_revision`.
- **Laika records what it delivered, never what was understood** (§4.69). An
  agent behind on the document is told so in one short line on its next
  answer (§7.2); the whole document is sent only when asked for.
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

**Environment**: `LAIKA_URL`, `LAIKA_TOKEN`, stored once per machine in
`~/.laika/env` by the installer (D-046; `/laika:setup` writes nothing) and
exported to the plugin by `laika-claude`.

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

### 9.1.1 Claim leases: agent-session heartbeats (LAI-541)

A registered agent's session (§4.65) has heartbeats of its own,
`POST /agent-sessions/:id/heartbeat`, separate from the presence heartbeat above
and unchanged by it. **They come from the working process**: the local helper
renews only while the harness process holding the session is alive, which it
checks by PID, so a helper that outlives its harness stops renewing (proposal
§4.2, LAI-542). Each heartbeat stamps the session and **renews the lease of each
of its active claims** to *now + the claim expiry*. An MCP-only agent renews by
calling `start_working` again from its session (§7.1).

**The timings** — proposal §4.2's defaults, **each configurable per
deployment** through §11.7's variables:

| setting | default | variable | what it does |
| --- | --- | --- | --- |
| Heartbeat | every 30 s | `LAIKA_CLAIM_HEARTBEAT_SECONDS` | how often a session is expected to heartbeat; also the boot grace |
| Connection suspect | after 90 s | `LAIKA_CLAIM_SUSPECT_SECONDS` | a session silent this long is shown `suspect` — shown, decides nothing |
| Claim expires | after 5 min | `LAIKA_CLAIM_EXPIRE_SECONDS` | the lease: how long after its last renewal a claim lapses. Must be longer than the heartbeat |
| Expiry scan | every 30 s | `LAIKA_CLAIM_SCAN_SECONDS` | how often §11.6's scan marks lapsed claims `expired` |
| Checkpoint warning | after 5 min | — | a live claim with no checkpoint, or none newer than this, is shown *"No save in the last 5 minutes"* on the task (LAI-545). Shown, decides nothing |
| Pending notice | after 10 min | — | a `pending` checkpoint older than this is shown *"Verification pending — no push notice from GitHub yet"* (§4.70, D-116 item 6; LAI-545) |
| Offer expires | after 30 min | — | the default of the project policy's `offer_ttl_minutes` (§4.74; LAI-546) |
| Completed hand-offs per task | at most 3 | — | the default of the project policy's `max_handoffs` (§4.74; LAI-546) |

The last four are listed so the table is the proposal's whole. The two
policy defaults are set per project, not per deployment; the warning and the
notice become §11.7 variables with the work that reads them (LAI-545) — **not
before**, because §11.7 lists only what the server reads. Tests use an
injected clock.

**Fencing.** Every change an agent session makes to a task carries its claim's
generation (§6.3: `X-Laika-Claim-Generation`, `claim_generation`). A stale
generation, or a lease that has lapsed, is `409`, `reason: stale_claim`. **Two
agents of the same human are fenced from each other** exactly as two people's
agents are: the live claim names one session of one agent, and every other is
refused `claim_held`.

**An expired claim is never restored by itself.** Once a claim is `expired`,
its generation is **invalid for good**: any request carrying it is `409
stale_claim`, **even if the same session's heartbeats start again** — a
heartbeat reports it in `lost` and renews nothing, and a heartbeat that arrives
after the lease lapsed but before the scan expires it there rather than reviving
it. A plain `start_working` does not take it back either, and **omitting the
generation is no way round it**: every token's change to the task is refused
while the lapsed claim holds it (§6.3). **Only the explicit
reclaim** — `POST /tasks/:id/claim/reclaim`, or `start_working` with `reclaim:
true` — gives the agent whose claim expired a **new** claim, at `generation +
1`, in one `BEGIN IMMEDIATE` operation that re-checks the owner's permission,
the agent's status and grant and the token's scope, and appends
`task.claim_reclaimed`. The helper then carries the new generation; the old one
never becomes valid again. Any other agent is refused and waits for recovery
(LAI-546). **A `paused` claim** — its holder offered the task (§4.73) — is
renewed by heartbeats and expires on a lapsed lease exactly as an `active` one
is; only the fence treats it differently (`claim_paused`).

**Recovery speed versus disconnects.** A short expiry recovers abandoned work
quickly, but it also turns a laptop lid closed for six minutes into an expired
claim. Nothing is lost when that happens: **every** expiry — the scan's or a
late heartbeat's — opens a recovery offer when the task has a verified
checkpoint (LAI-546) — **never a silent reassignment** — and the task stays in progress,
assigned as it was. The laptop's owner reclaims explicitly for as long as
nobody has accepted that offer. A deployment whose agents sleep often lengthens
`LAIKA_CLAIM_EXPIRE_SECONDS`; one that wants abandoned work back fast shortens
it.

**Reconnecting.** A session whose heartbeats were merely late — inside the
lease — carries on: the next heartbeat renews from then. A session whose claim
expired sees it in `lost`, stops writing under it, and reclaims if it still
wants the task. A session that **ended** (its agent said so, or was revoked)
cannot heartbeat (`409 stale_claim`); its claims were released when it ended,
or — for a revoked agent, whose token is refused at the door anyway — lapse and
expire like any other.

**Server restart.** Leases are stored as timestamps, so nothing about a claim
lives only in memory. **During a boot grace of one heartbeat interval nothing
lapses** — a server that was down did not hear the heartbeats it was sent, and
a session that heartbeats inside the grace keeps its claim, its overdue lease
renewed from then. After the grace, the first expiry scan catches everything
still overdue.

### 9.2 Branch names carry task ids

Convention **`lai-<number>-<slug>`** — `lai-42-add-task-crud`. The server matches
`(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,7})-(\d+)` case-insensitively — §4.3's prefix
shape, a letter then one to seven letters or digits, never starting inside a
word, so `p0x-12-fix` reads `P0X` (LAI-177) — against project prefixes, current
and former (D-103 addendum), resolves the task, and
stores `matched_task_id` on the heartbeat and `branch` on the task.

**Resolution is server-side**, always: the plugin cannot know a deployment's
project prefixes. Anything unparseable is kept as a plain branch string — it
degrades, it never errors.

### 9.3 Derived views

Presence and capacity attribute a heartbeat to a project by **§9.1's rule, at
request time**. Nothing is stored on the heartbeat — consistent with there being
no separate presence store to fall out of sync, and a single column could not
hold a result that is legitimately many.

- **Presence** (`GET /api/v1/presence`) — users with a heartbeat, **an `/mcp`
  call on a token** (D-076) **or a REST write on a token** (D-081) in the last 5
  minutes. "Who is working right now." A REST write is any token-authenticated
  request under `/api/` but `GET`, `HEAD` and `OPTIONS`: **a read does not
  count**, so a script polling with somebody's token does not keep them online,
  and a web session never counts, having no token. One entry per user, the
  newest session winning. Each entry carries `client`,
  the `AGENT_CLIENTS` slug of the newest live agent session or `null`, and
  `clients`, every distinct agent among that user's live sessions, newest
  first; a REST session's agent is its token's, as for a heartbeat. `is_agent`
  is true for a heartbeat on a token or any live `/mcp` call or REST write.
  A token that is revoked or expired is not present, **whether it was last seen
  by `/mcp` or by heartbeat**, and does not count in Capacity. A signed-in
  session's heartbeat, which has no token, is unaffected.

  **An `/mcp` call or a REST write carries no location.** Only a heartbeat
  supplies `repo`, `branch`, `project_ids` and `matched_task_id`, so a user seen
  only over MCP or REST has `repo` and `branch` absent, `project_ids` empty and `matched_task_id`
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
  is stored (LAI-150) and no token's `last_mcp_at` or `last_rest_write_at` is
  stamped (D-076, D-081), so
  turning it back on shows nothing from the time it was off. The connecting
  client's name is still kept on the token, as token metadata.
- **Capacity** (`GET /api/v1/capacity`) — per user: `active_sessions` (distinct
  tokens seen by heartbeat, `/mcp` call or REST write in the window, one token
  doing several counted once; D-076, D-081),
  `in_progress_tasks[]`, `last_seen`, oldest in-progress age, tasks in review
  awaiting them, and `unlisted[]` from `log_unlisted_work`. Answers "who takes
  the next thing" and "what is stuck with nobody on it".

  **Since LAI-767 each entry also carries**, in one pass over the people (a
  fixed number of queries whatever the headcount):

  - `email` and `org_role` — what the member list already shows every role.
  - **`last_seen`, redefined**: the newest of the person's last **sign-in**
    (their newest session row's `created_at`), their last **activity-log
    row** (§4.8 — a web session's, or an agent's only while the token that
    wrote it can still make a request), and their agents' last **heartbeat,
    `/mcp` call or REST write** on a token that can still make a request
    (D-076, D-081) — at any age, not only inside the window. A session's `updated_at`
    does **not** count: better-auth slides it once a day on whichever request
    comes first, an open tab's background poll as often as a person, so it
    would mark someone asleep as online. Reads never count, as D-081 settled
    for tokens. `null` when there is no signal. `last_seen_via` says which
    kind it was: `web` (a sign-in), `board` (an activity row from a web
    session) or `agent` (a token's heartbeat, call, write or activity row).
  - `status`: `online` when `last_seen` is inside §9.3's five minutes (the
    same strict `>` as a live session), `away` inside the last hour, `offline`
    after it, `never` with no signal at all.
  - `workload`: their open assigned tasks — `in_progress`, `todo` (a To do
    status: committed, not started), `backlog` (a Backlog status: the
    pipeline), `in_review` (waiting on a reviewer, not on them), `committed`
    (`in_progress` + `todo`), `open` (all four together), `overdue` (due
    before today, UTC, and not finished — the client's `isOverdue`) and
    `due_soon` (due today or within the next seven days). Counted over the
    projects the reader may read, as `in_progress_tasks` always was.
    `spaces[]` gives the same counts per project they have open work in, with
    its `slug`, `name` and **its own `load`** by the rule below — the badge
    shown while that space is selected (D-092, LAI-818). Most committed
    first, then most open.
  - `load`, **a fixed rule, not a setting**, on **committed work** (D-092
    item 3, LAI-818): `none` with nothing committed; `heavy` with more than
    **5** in progress **or** more than **15** committed; `light` with at most
    **2** in progress and at most **5** committed; `normal` otherwise. Review
    waits on the reviewer, backlog is the pipeline and overdue is its own
    badge, so **none of the three is load**.
  - `agents[]`: `{ client, running, last_at }`. Every reader gets the agents
    running now (what `/presence` already says); an owner or admin also gets
    every agent on that person's usable tokens that has been used, with its
    token's newest use (D-076, D-078) — token metadata a member is not shown.
  - **Owners and admins only, on a web session** — absent, not empty, for
    anyone else and for every token, by `profile.read` and
    `profile.activity.read` (D-078, D-079): `profile_kind`,
    `activity_14d`, the person's board actions on each of the last 14 UTC
    days from `board_activity_days`, oldest first, ending today, and
    `activity_14d_split` (LAI-818): `{ by_self, by_agents, bookkeeping }`
    over the same days. `bookkeeping` is their sprint moves
    (`sprint.tasks_changed`) and card reorders (`task.updated` naming
    `position`, D-060.4) by either hand, counted from §4.8 over the window
    through `activity_org_created_at_idx`; `by_self` and `by_agents` are
    §4.22's columns less that bookkeeping, so the three sum to the series.

  **With `presence_enabled` off**, `status`, `last_seen` and `last_seen_via`
  are `null`, no agent is `running` and every agent's `last_at` is `null`: the org chose not to record who is
  working, and the activity log must not answer that by another route. The
  workload is board data and is served either way.

Both are computed from `heartbeats`, `tokens.last_mcp_at`,
`tokens.last_rest_write_at` and `tasks` at request time. No separate presence store to fall out of sync. With `presence_enabled`
off, neither shows any session from either source.

---

## 10. Webhooks and the meeting diff

Mounted at `/webhooks/*`, outside `/api/v1`, no user session.

### 10.1 `POST /webhooks/github`

HMAC-SHA256 verified against the org's webhook secret (`X-Hub-Signature-256`),
constant-time compared, **before the body is parsed**. Unverified requests get
`401` and are logged as `webhook.received` with `verified: false`.

Handled: `push` (branch → task, `webhook.commit` activity), `pull_request`
(opened or reopened → link PR and move `in_progress`, **only from `backlog` or
`todo`**; merged → move to `review`, **never to done**, D-082; a task already
in review or done, or one `opened` cannot move, is left where it is with a
`200`, D-083), `issue_comment` (mirror to task comments), and `check_run`,
`workflow_run` and `check_suite` (CI results for the proof, D-083). Everything
else is acknowledged and ignored. Delivery ids are deduplicated for 24h.

**A push stores what a reader needs** (LAI-753): one `webhook.commit` row with
`{ repo, branch, default_branch, count, shas, forced }` — `shas` the first 50,
`count` how many the delivery listed — against the task the branch names, or
against the project whose `repo` is the repository when it names none, **the
default branch included**. No author: D-050 refused mapping a commit's author
to a Laika user. A deleted branch or a tag is acknowledged and stores nothing
— **except a checkpoint tag**, below.

**Checkpoint tags verify checkpoints, and nothing else does** (D-116, §4.70 –
§4.72, LAI-545). A signed `push` delivery whose `ref` is
`refs/tags/laika-ckpt/…` and whose repository is **the project's configured
repo** is stored as one §4.72 transition `before → after` **keyed by the
repository and the ref's name**, under §3.4's `system.checkpoint.verify`, in
one transaction that also stores the `X-GitHub-Delivery` id and, when a §4.71
ref of that name is registered, re-derives its state from **every**
transition seen for the name — never from which arrived last (D-116a).
Deliveries for the same ref are applied one at a time. **A delivery that
arrives before its checkpoint is registered** — the normal race, since the
helper pushes first — is stored the same way, and registration derives the
new ref's state from the rows already there, in its own transaction; it is
never held in memory and never lost. A delivery
from any other repository verifies nothing. **The server never calls GitHub
and never fetches a URL** (D-083, §13.4): a checkpoint is `verified` only by
what a signed delivery said, and never because an agent says so. What this
costs is D-116's *Limitations*: a deletion GitHub never notified stays
`verified` here until a receiver's fetch fails, and while the webhook is down
every new checkpoint stays `pending` until it is redelivered (3 days) or
re-tagged. **Operators protect the tags** with a tag ruleset on
`laika-ckpt/**/*` — *Restrict updates* and *Restrict deletions* — and keep
them 90 days after the task is done or cancelled; Laika never deletes one.

**Every `push`, `pull_request` and CI delivery is also remembered for the
proof** (§4.28–§4.30) and re-checks every round it could change (§4.31). No
call is made to GitHub (§13.4): everything comes from what was delivered.

**GitHub does not retry a failed delivery.** One that times out or answers
non-2xx stays failed until somebody presses *Redeliver* on the webhook's
*Recent Deliveries* page. Every push to `master` restarts production (D-073),
so a delivery that arrives during a restart is lost unless redelivered by
hand; the Organisation screen says so.

**Setting it up on GitHub** (repository or organisation → Settings →
Webhooks → Add webhook): *Payload URL* the Organisation screen's
(`<LAIKA_PUBLIC_URL>/webhooks/github`), *Content type* `application/json`,
*Secret* the one the screen showed, and *Let me select individual events*:
**Pushes, Pull requests, Issue comments, Check runs, Check suites, Workflow
runs**.

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
  work, draws nothing (D-069). Each is a card-field toggle. So is the **size**
  (D-085), which the screen calls **Effort** (LAI-785): a small `XS`–`XL` chip,
  with a dot when a person set it and the level in words on hover; no hours on
  the card.
- Cards **do not** show a stale marker, a comment count or an age (D-069).
  Staleness is still flagged by the server, one rule for every screen (§11.6),
  and listed in Activity;
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
status, assignee, priority, dependency count, effort (the size, D-085 —
headed *Effort*, sorted by level, then weight, and still `sort=size` in the
URL), due, updated — the title's sub-line names the parent (`↳ KEY`)
and the blockers. Sortable on every column, multi-filter on status / assignee /
priority / ready / blocked. This is the view
for triage and for boards too large to drag. It opens **newest-updated first**,
and its sort is URL state like the filters (D-065). Created and updated read
`just now` / `N min ago` / `N h ago` for a day, then a date and time, with the
full timestamp on hover. Updated is **amber when the server flagged the task
stale** (§11.6's one rule, LAI-832), its hover then saying *flagged stale 1d
ago*.

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
- share one **search box, which matches a task's title, its key and its outside
  id** (LAI-251, LAI-780), in the browser, over the project's task set — and
  **not its description or acceptance**. The list is read slim (§6.4,
  LAI-795), so the texts are not there to match, and that is the decision, not
  a gap: loading every task's text into every list to search it is the cost
  LAI-795 removed, and the search never matched descriptions before it either.
  Searching the texts would be a server-side text parameter on the list, which
  §6.4 does not have;
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
| the sidebar | **My day** and **Inbox** (its count is Review's waiting plus Unlisted work's open, for whoever may see each) at the top; **SPACES** — the recent spaces, each with a coloured letter, *+* to create, *More spaces*; **ORGANISATION** — *Insights* (with the reader's open token alerts), *Organisation*, *Developer access*. At the foot, the person: a menu with *My profile* (owners and admins, who alone may open a profile), *Switch to dark / light*, *Developer access* and *Sign out*. No other entries | D-059.1, amended by **D-061**; **LAI-796** (the owner, 2026-10-20) |
| the icon rail | a toggle in the sidebar's head collapses it to icons — each entry's icon, its count on the icon's corner, its name in a tooltip on hover and keyboard focus — remembered per browser; automatic between the phone's off-canvas width and a laptop's; never on a phone, where the sidebar is off-canvas | **LAI-796** |
| a space's tabs | two groups with a hairline between — *Board, List, Timeline, Calendar* \| *Sprints, Dashboard, Activity, Meeting review* — and *Agents* and *Create* on the right | **LAI-796** |
| Task detail | a **centred modal over a dimmed board**, dismissed by the scrim or Escape — not a screen, and not a right-hand drawer | D-059.2, amended by **D-063** |
| Timeline, Calendar, Dashboard, Meeting review | **tabs across the top of a space** | **D-059.3** |
| Inbox, Insights, Developer access | **one page each, across every space the reader can see**, no space bar: **Inbox** (`/inbox`) is *Review* and *Unlisted work* as tabs, each with its count; **Insights** (`/insights`) is *Capacity* and *Usage & cost*, the page's period chosen in its header where the screen has one; **Developer access** (`/developer`) is four tabs since LAI-507 — *Connect* (the wizard), *Projects*, *Activity*, *Tokens*. A tab is `?tab=` | **LAI-754** — *"Capacity must not be at project level; it must go to the sidebar and be global"*; regrouped by **LAI-796** |
| old addresses | each redirects, in place and keeping its query, to its new home: `/review` → `/inbox?tab=review`, `/unlisted` → `/inbox?tab=unlisted`, `/capacity` → `/insights?tab=capacity` (dropping a `?project=` from when it was a space tab), `/usage` → `/insights?tab=usage`, `/tokens` → `/developer?tab=tokens`, `/connect` and `/developer/connect` → `/developer?tab=connect` (keeping `?agent=` and `?step=`) | **LAI-796**; **LAI-507** |
| Organisation | four tabs — **Overview** (members, spaces and pending invites counted; *Presence*, *Developer insights*, *Time*; the spaces), **People** (members and invites), **Integrations** (GitHub webhook, model prices, AI provider), **Security** (everyone's tokens, owners and admins) | **LAI-796** |

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
| **Task detail** *(slide-over on Board, not a nav item)* | 2 | `GET/PATCH /tasks/:id`, `GET /tasks/:id/rounds`, `GET /tasks/:id/estimate`, `GET /tasks/:id/usage` (with cost, budget and runaway, LAI-773), `GET /projects/:slug/budgets`, `PUT /tasks/:id/budget`, `GET /projects/:slug/estimates/accuracy`, `GET/POST /tasks/:id/comments`, `PATCH/DELETE /comments/:id`, `POST/DELETE /tasks/:id/dependencies`, `GET /projects/:slug/activity`, `PUT/DELETE /tasks/:id/watch`, `GET /tasks/:id/watchers`, `GET /projects/:slug/mentionable` | `add_comment`, `get_task_context` | ✅ |
| **Sprints** | 2 | `GET/POST /projects/:slug/sprints`, `GET/PATCH/DELETE /sprints/:id`, `POST /sprints/:id/tasks`, `DELETE /sprints/:id/tasks/:taskId`, `GET /projects/:slug/tasks?sprint=`, `GET /sprints/:id/forecast` (each sprint not completed, LAI-772) | — | ✅ D-013 |
| **Timeline** | 2.5 | `GET /projects/:slug/timeline`, `GET/PATCH /sprints/:id` | — | ✅ D-014 |
| **My day** *(sidebar, the reader's own)* | 8 | `GET /me/time`, `GET/PUT /me/time-settings`, `PATCH /me/time-drafts/:id`, `POST /me/time-drafts/:id/split`, `POST /me/time-drafts/:id/dismiss`, `POST /me/time-drafts/:id/confirm`, `DELETE /me/time-drafts`, `POST /me/time/days/:day/confirm`, `POST /me/time-entries`, `PATCH/DELETE /me/time-entries/:id`, `GET /me/time-entries/:id/revisions`; *On your plate* (LAI-796): `GET /projects`, `GET /projects/:slug/tasks?assignee=&status=` (slim), `GET /tasks/:id` (an outside blocker), and the review queue the sidebar's badge already read | `propose_time_entry` | ✅ D-088, LAI-796 |
| **Tokens** *(on Developer access)* | 3 | `GET/POST/DELETE /tokens`, `GET /users/:id/tokens`, `DELETE /users/:id/tokens/:tokenId` | — | ✅ |
| **Organisation** *(four tabs, LAI-796)* | 1 basic / 6 LLM | `GET /projects` (Overview's spaces), `GET/PATCH /org`, `POST/DELETE /org/github-webhook`, `GET /org/model-prices`, `PUT/DELETE /org/model-prices/:model` (LAI-773), `GET /users`, `PATCH /users/:id`, `GET/POST /invites` | — | ✅ |
| **Connect** *(Developer access's first tab, `/developer?tab=connect`; not in the prototype)* | 7 | `GET/POST /tokens`, `GET /presence`, `GET /org`, `GET /me/activity-sharing` (whether the organisation collects, so the machine prompt turns the collector on), `GET /projects` (the Projects tab), `GET/PUT /me/activity-sharing`, `GET/DELETE /me/local-activity` (the Activity tab) | — | ✅ D-079, D-084, D-087, LAI-507 |
| **Capacity** *(Insights' first tab, global)* | 5 | `GET /capacity`, `GET /presence`, `GET /projects` (no task is read — LAI-992), `GET /review` (the waiting count), `GET /unlisted` (the open count, owners and admins) | — | ✅ LAI-754, LAI-767 |
| **Review** *(Inbox's first tab, global)* | 5 | `GET /review` (with each task's `cue`: a *check this one* chip and filter, LAI-772), `GET /tasks/:id/rounds`, `POST /tasks/:id/accept`, `POST /tasks/:id/send-back` | `finish_task` | ✅ D-082 |
| **Unlisted work** *(Inbox's tab, global; owners and admins)* | 3 | `GET /unlisted`, `POST /unlisted/:id/promote`, `DELETE /unlisted/:id`, `GET /users` | `log_unlisted_work` | ✅ LAI-754 |
| **Member profile** *(owners and admins; not in the prototype)* | 7 | `GET/PATCH /users/:id/profile`, `POST /users/:id/ratings`, `GET /people/:id/activity`, `GET /users/:id/usage` | — | ✅ D-078, D-079, D-084 |
| **Usage** *(Insights' *Usage & cost* tab, global; not in the prototype)* | 7 | `GET /usage` (with `rework` per project, LAI-772; cost, cache, accepted, budgets, runaway, LAI-773), `GET /projects`, `GET /users/:id/usage` (the reader's own), `GET /projects/:slug/budgets`, `PUT /projects/:slug/budget`, `PUT /sprints/:id/budget`, `GET /me/token-alerts`, `POST /me/token-alerts/:id/dismiss`, `GET/PUT/DELETE /me/plan-limit` | — | ✅ D-084, D-087 |
| **Dashboard** | 5 | `GET /projects/:slug/metrics`, `GET /projects/:slug/tasks`, `GET /projects/:slug/activity`, `GET /projects/:slug/members`, `GET /projects/:slug/mentionable`, `GET /projects`, and the review queue the sidebar's badge already read (`GET /review`, each task's `waiting_since` for the review wait, LAI-832) | all, indirectly via `activity` | ✅ |
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
  (D-082): the send-back it carries first, then the latest round — round
  number, the agent that finished it, commits (short sha and first line),
  branch, pull request as a link only when `http(s)` and *merged* once GitHub
  says so, test commands with their exit codes in green for `0` and red
  otherwise, a state badge on every item — `claimed` grey, `confirmed` green,
  `failed` red (D-083) — and a **CI line** beside the tests (*CI: 3 of 3
  checks passed*, *CI: lint failed*) — with earlier rounds folded. A comment that is a send-back's reason is
  marked *sent back*, and a card carrying a send-back wears a *sent back*
  marker with the reason as its tooltip.
  **An Effort section under Acceptance** (D-085, plain words since LAI-785):
  one headline — the effort in words and the build time as one plain range,
  *Small · about 40 min to 1.5 h*, with *rough estimate* beside it when the
  project has fewer than 5 measured estimates or is typically off by more than
  2×; with too little history for hours, the effort and *Time estimate after
  10 finished tasks*, once. A range that reaches days says both ends in days
  (*1–2 d*, never *24 h–2 d*). Once it has finished, one line against the
  estimate frozen when work started, with a verdict — *Estimated at start
  40 min–1.5 h · took 1.6 h · a little over* — **judged on the figures
  printed** (LAI-785 review): below the shown low end is *faster than
  expected*, the shown range is *on target*, up to 1.5× the shown top is *a
  little over*, and beyond that *well over*. When there was more than the
  build, where the time went: *Building 1.6 h · waiting for review 41 h ·
  rework 20 min*. The token estimate is one line when there is one and
  nothing when there is not. A small *Change* control beside the effort for
  anyone who may edit the task —
  *Automatic (Small)*, *Extra small* … *Extra large*. A folded *Why Small?*
  holds the factors as sentences with arrows (*↓ No acceptance criteria (most
  tasks here have 3)*), leaving out what changes nothing, the similar finished
  tasks as links, what was said at claim, and the project's accuracy in words
  (*Estimates here are typically off by about 2.4× (6 tasks so far)*) — the
  figure is a median, and it is told only once 3 estimates are measured.
  Nothing empty is drawn — no `—`, no *Early* — and no figure is about a
  person.
  **A Tokens section under the proof** (D-084, LAI-770; one headline since
  LAI-785): the task's tokens without cache reads, labelled *at least*, and
  their **cost**, *API-equivalent, not your bill* (LAI-773); its **budget** as
  a bar with an 80% or 100% badge **only when a lead set one**, with — for a
  reader who may set budgets (`can_set` from `GET /projects/:slug/budgets`) —
  a field to change it and *Back to the estimate*. The default budget, the
  token estimate's high end frozen at claim, draws nothing until 80% and then
  one line: *Past its token estimate: 4.01M of 2.5M (160%)*. And, **only for
  the person it is addressed to**, the runaway banner: *your agent has spent N
  on this task, past its p95 of M, and nothing has landed for T*. Everything
  else sits in one folded **Details**: cache reads; the attributed share — how
  much of those people's work on those days Laika could tie to a task — or,
  for a reader who sees nobody's part, what the figure counts; the build's
  token estimate; what the cost leaves out; a budget for a lead to set; per
  review round; and per person and agent for an owner or admin, the reader's
  own part for anyone else, nothing per person on a token. Not drawn for a
  task never started that has none; one quiet line for a started one that has
  none.
  **A watch toggle and who else is watching** (D-047, D-054), and an
  **`@` autocomplete in the comment box fed by `GET /projects/:slug/mentionable`
  — never by the member list**, because who may be mentioned is the server's
  answer and not a filter the client reapplies.
  A mention that names someone — a handle exactly one person on that list
  holds — shows as a pill wherever the panel reads or edits the task's text,
  the reader's own stronger and `@strelka` / `@belka` softer, and the stored
  text does not change (LAI-868).
- **Sprints** — sprint list with dates, goal and status; active-sprint emphasis;
  task assignment in and out; counts by status; the one-active and no-overlap
  rules surfaced as errors, not silent failures.
- **Timeline** — one bar per sprint across a time axis, today marked, past
  dimmed; task counts per bar; unscheduled tray; drag an edge to reschedule with
  overlap rejection. **No per-task bars** (D-014).
- **The sidebar and its rail** (LAI-796) — the entries and their order as the
  §11.4.2 table says; every entry an icon and a label, a count only where it
  is real and non-zero; the rail keeping every icon and count and naming each
  in a tooltip on hover and on keyboard focus; the user menu opening from the
  person at the foot, reachable and closable from the keyboard (arrows, Home,
  End, Escape) and by a click outside.
- **Developer access** (`/developer`, LAI-796; four tabs since LAI-507,
  D-111) — a sentence on what a token is, then **Connect · Projects ·
  Activity · Tokens**, in the order a new developer meets them. *Connect* is
  the four-step wizard below, embedded: its header gives up its band and hands
  the board's address to the page header. *Projects* is what is **once per
  project**: pick the project and the agent, and the tab gives the block for
  that agent's instructions file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  Cursor's rules file, … — `instructionsTarget`), to commit by hand, and an
  *Add this project* prompt that has the agent append the block to that file
  if its marker line is absent, create the file if missing, change nothing
  else and commit nothing — no install, no token; for an editor that reads its
  MCP config from the repository (VS Code, Omnigent) one line names
  `laika connect <id> --project`. *Activity* is the *Share local activity*
  panel below, once. *Tokens* is the Tokens screen, its *New token* in the
  page header. Every setup block and the project block carry a chip, *Once
  per machine* or *Once per project*. The compact *Connect an agent* card and
  the wizard's *Optional* rail are gone, and so is *Invite a teammate*: an
  invite is Organisation → People's.
- **Tokens** (on Developer access) — create with name and scope; **value shown exactly once** with a
  copy affordance and an explicit "you will not see this again"; list with
  prefix, scope, last used, expiry; revoke with confirmation; admin view of
  another user's tokens (Organisation's *Security* tab).
- **Organisation** — in four tabs since LAI-796 (§11.4.2's table): the org's
  name, mark, owners and creation date in the header with *Invite people* for
  owners and admins, which opens *People* at the invite form; on *Overview*
  members, spaces and pending invites counted from the page's own reads, and
  the spaces with members, open tasks and status, each opening its board.
  Nothing the organisation has no data for — a plan, an admin log, a
  permission matrix, a token lifetime, a danger zone — is drawn. Org name; AI provider config showing `configured / provider
  / key_last4` and **never the key**; invites with role at invite time; member
  list with role controls; danger zone gated to Owner; a **Developer insights**
  switch for owners and admins (§4.2, D-079; the one switch since D-102
  amended) with a plain sentence of what it allows, read-only for everyone
  else; and a **GitHub webhook** section for owners and admins
  (LAI-753): whether a secret is set, *Set secret* / *Rotate secret* / *Clear*,
  the new secret shown once with a Copy button, the payload URL with its own
  Copy, the content type, the events to tick, and one line saying GitHub does
  not retry a failed delivery. A **Model prices** section (LAI-773) for
  everyone who opens the page: each model's input, output, cache-write and
  cache-read price per million tokens, where it came from — *from the price
  page* with its link and date, *inferred* with why, or *the organisation's
  own* with the day it was set — under one line saying every cost is
  API-equivalent, not a bill, and that Laika never fetches a price. Owners and
  admins (`can_set`) edit a row, remove an override, or price a model the
  table does not have.
- **Connect** (`/developer?tab=connect`; `?agent=` sets the agent and
  `?step=2` opens on the token) — the four-step wizard: choose the agent, mint
  a token, add Laika to the agent, check it connected. **Everything in it is
  once per machine** (LAI-507): the Claude Code *Set up this machine* prompt
  clones or pulls the plugin, runs the installer on stdin, checks
  `GET /api/v1/me` answers, and — only when `GET /me/activity-sharing` says the
  organisation collects — runs `laika activity on --yes`; it says to skip the
  install when `laika whoami` already answers, writes into no repository, and
  ends by telling Claude not to use the tools in that session. The CLI route
  for the other agents gains the same last line. *What agents can do* is a
  disclosure under step 4; step 4, connected, offers *Add this project*, which
  is the Projects tab. The **Share local activity** panel (Developer access's
  *Activity* tab, D-079, D-102 amended): what is sent — token counts per
  agent and model among it (D-084 item 4) — and what is never sent; whether
  the organisation collects, said plainly, with no switch of the developer's
  own; the scope (every repo where they use an agent, or only repos set up
  for Laika); the `laika activity on` command; a preview of what the server
  holds for them over the last 14 days, their tokens per day among it; and
  *Delete my local-activity history* with a confirmation. With the
  organisation's switch off it says so and offers nothing to turn on. Beside
  it, **OpenTelemetry (optional)** (LAI-773, LAI-867): what `laika activity
  on` writes to `~/.claude/settings.json` (§6.4) with this board's URL filled
  in and no token, a Copy button, and one line saying `laika activity on`
  sets it up on each laptop, it is metrics only and fills in what the session
  files miss.
- **Capacity** (Insights' first tab, `/insights?tab=capacity`, one page across
  every space, LAI-754; redesigned by LAI-767) — **tiles** that count and
  filter: *Online now*, *Agents running* (sessions), *In progress* (sorts
  heaviest first), *Waiting for review* (links to Inbox's Review tab; *200+*
  when `GET /review` is `truncated`, LAI-818), *Overdue*, and for owners and admins
  *Unlisted work* (links to `/unlisted`). A **toolbar**: a search by name or
  email, instant and in the browser; filter chips *All*, *Online now*,
  *Agents running*, *Heavy load*, *Overdue*, *No load*, *Never seen*.
  ***No load* is the load badge's word and the badge's rule** (LAI-832): people
  with nothing committed, `{ id: 'none', label: 'No load' }` passing when
  `loadIn(person, space) === 'none'` (`capacity-derive.ts`), the selected
  space's load when one is selected, as *Heavy load* reads it. Backlog and work
  waiting on reviewers do not count against it. It was *No work*, no open work
  at all; the id stays `none`, so a saved address still opens it. The toolbar
  goes on with a space selector (all spaces, or one, which narrows every count
  to it); a sort
  (*Online first*, the default, *Heaviest load*, *Name*, *Last seen*); a
  **Cards / List** toggle, remembered per browser (LAI-991); an (i)
  with the definitions. **One card a person** in a grid of three columns on a
  laptop, two on a tablet and one on a phone — **every card draws every block
  in the same order, and a block with nothing to say draws a `0`, *No agents
  running* or *No spaces* rather than disappearing, so the cards in a row are
  one shape and one height** (LAI-991, the owner's design): the avatar with a status ring
  and dot (green online, amber away, grey offline, dashed never seen) and the
  same in words — *Online now*, *Away · 23 min*, *Last seen 2 h ago* with the
  date and time and the kind of signal on hover, *Never seen*; name, org role,
  and for owners and admins the profile kind; the load badge with its rule on
  hover — **the selected space's load** when one is selected, and the *Heavy
  load* chip reads the same — and beside it an *N overdue* badge of its own
  (D-092, LAI-818); the workload counts
  *in progress · to do · backlog*, a thin stacked bar of committed work (in
  progress, to do), and apart from it *N waiting on reviewers* and *due in 7
  days*; *Agents · N running*, their agents with a green dot on each one
  running, or *No agents running*; for owners and admins *Activity · 14 days
  · total*, the fortnight as three figures, *by hand · by agents ·
  bookkeeping* from `activity_14d_split`, each with what it counts on hover
  and **no bar chart** (LAI-996); *Spaces · N*, the spaces they have open work in as chips
  carrying the space's colour (the sidebar badge's, keyed by slug) and its
  committed count, with backlog and review on hover, or *No spaces*; the name
  linking to the profile for owners and admins. **No task is read and no
  task is listed** (LAI-992, the owner): the *Show tasks* footer and the
  *working on LAI-9* line LAI-767 drew each cost a `GET /tasks/:id`, and the
  workload counts already say how many are in progress. **Nor the sparkline**
  (LAI-992): the 14-day bar chart is the profile's; the three figures stay
  (LAI-996). **Every figure with a rule
  behind it says the rule on hover** — the load badge, overdue, each count,
  each activity figure, each space and agent chip, the status line — the same
  words on a card and in the list. People never seen
  fold into one line at the bottom, unless searched for or filtered to.
  **List** draws the same people, filtered and sorted the same way, as a
  table: person, load, a workload bar, in progress, to do, review, agents
  running, for owners and admins *hand · agents · bookkeeping*, and spaces.
  **Every row's bar is drawn to one scale, the heaviest committed count on
  the page, so the table is the team-load chart** — it replaced the *Team
  load* and *Agents running now* panels that LAI-767 put under the grid
  (LAI-991); the *Agents running* tile and each card's agents carry what the
  second panel said. A legend under either view names the bar's two parts. It
  re-reads every 20 s while the tab is visible and when it comes back; the
  loading skeleton is the final layout; no matches has its own state. With
  `presence_enabled = 0` it says so, keeps the workload and draws no status.
  **No unlisted notes on this screen** — they are on their own page.
- **Inbox** (`/inbox`, LAI-796) — *Review* and *Unlisted work* as tabs, each
  with its count; Unlisted work only for owners and admins. The sidebar's
  Inbox count is the two added.
- **Review** (Inbox's first tab, `/inbox?tab=review`, everyone signed in, D-082) — the queue of tasks in a
  review status on every project the reader can act on, **oldest waiting
  first**: key, title, project, assignee, the agent that finished it, time
  waiting, the proof in brief (commits, PR, tests passed and failed, or *no
  proof*) and the round. A summary card of tiles — waiting, oldest, failing
  tests, no proof — with an (i). Filters: project, assignee, *Failing tests*,
  *No proof*, *CI failed*, *CI confirmed* (D-083). Each row's proof in brief
  carries the CI result when GitHub reported one. A row opens the full proof (the task panel's Proof section) with
  **Accept** and **Send back…**, the second asking for a required reason in a
  dialog; both are disabled, saying why, for a reader who may not decide.
  *Open on board* opens the task. The waiting count is on the tab and in the
  sidebar's Inbox count. There is no organisation-wide stream, so the page re-reads
  every 20 seconds, when the tab returns and after each decision.
- **Unlisted work** (Inbox's tab, `/inbox?tab=unlisted`, owners and admins, LAI-754) — **one line per
  note**: repo, who, when and the note's first line, newest first; a click opens
  the full text with **Promote to task** and **Dismiss** under it; the first
  page of lines and then *Show more*; a *Show dismissed* toggle; the open count
  on the tab and in the sidebar's Inbox count.
- **Dashboard** — shaped like Jira's project Summary (D-072): **done, updated,
  created and due soon** for the chosen range; a **status donut** with the share
  done at its centre; a **donut of open work by person** (*Open work now*, as of
  now whatever the range, D-092 item 2), Unassigned as its own share, each
  person opening the board filtered to them; activity feed with an
  **agent/human filter**; **needs attention**, true counts, in three tabs —
  *Blocked*, *Stale* (the server's flag, §11.6) and *Waiting for review > 5
  days* (`REVIEW_WAIT_DAYS = 5`); priority breakdown; throughput and cycle
  time; updates in place on a live change; read-only for Viewer.

  **A person's open work is their load: to do and in progress** (D-092 item 3,
  LAI-832), Capacity's rule — `count: committed(slot.byStatus)`, where
  `committed` is `byStatus.todo + byStatus.in_progress` (`summary-derive.ts`
  `workloadByPerson`). **Backlog shows separately**: a line of its own under
  the name, `+{row.backlog} in backlog`, with `+{row.review} waiting for
  review` on the line below it, and neither is in the count. Backlog and
  *Waiting for review* are
  each one share of the ring, and its centre is every open task.

  **The review wait reads the review queue, not the picked range** (LAI-832).
  A task's wait starts at `GET /review`'s `waiting_since`, taken from the
  shell's existing read (the sidebar badge's, so no request of its own), or at
  the range's own move into review — the later of the two when both hold one
  — so a task ten days in review stays listed on *Last 24 hours*. With neither
  it falls back to `Math.min(task.updated_at, rangeStart ?? task.updated_at)`,
  which does move with the range. **Limit:** `GET /review` answers only the
  projects where the reader holds `task.write`, and only its oldest 200, so for
  a project viewer, and for a task beyond the oldest 200 in review, the wait
  still depends on the range (LAI-850).
- **Meeting review** — the proposals, tagged **NEW / CHANGED / DEAD /
  DECISION**, each shown **with the transcript quote it was reacting to**;
  per-line accept and reject; apply acts only on accepted items; discard the set.
  **There is no transcript pane, because there is no transcript** (D-056): §4.12
  keeps a `transcript_hash` and never the words. The quotes are what makes a
  proposal reviewable, and they are all that is kept.
- **Usage** (Insights' *Usage & cost* tab, `/insights?tab=usage`, everyone
  signed in, D-084, LAI-769) — in the page's header, a **space selector** (an owner or admin: *All spaces* and every
  space; a member: only the spaces they are in, never the organisation) and a
  range of 7, 30 or 90 days. **Tiles**: *Tokens* — input, output and cache
  writes, labelled **at least** — *Cache reads* apart, *Unattributed* with the
  share tied to a task, and *Per day*. One line says why every figure is a
  floor. **Tokens per day** as bars from a zero baseline, one tab stop, arrow
  keys and hover showing each day's exact figures. **By developer** for owners
  and admins only, **in name order** — each name a link to the profile — and
  for a member one sentence saying per-person figures are for owners and
  admins; **by agent**, with each connected agent that keeps no token count
  named *no token data*; **by model**; **top tasks** (where a key exists),
  each opening the task; and **Your tokens**, the reader's own card. **A space
  says what it cannot hold**: no *Unattributed* tile there (it would always
  read 0%) but *Outside any space* — the organisation's unattributed share for
  an owner or admin, with *Show all spaces*, and for a member a sentence saying
  whose figure that is — and a space nothing is tied to yet says so in words
  rather than drawing zeros. LAI-773 adds: a **For you** banner of the
  reader's own alerts (`GET /me/token-alerts`) — a runaway first, then budgets
  at 100% and 80% — each with *Dismiss*, and one line saying they are soft and
  a runaway alert is the reader's alone; **tiles** *Cost* (API-equivalent, not
  your bill, with what went unpriced or was inferred) and *From cache* (the
  cache-read share and the estimated saving); a line for what Claude Code's
  telemetry added; cost on each model (*no price* rather than $0) and, where
  *By developer* is drawn, beside each name; **Cost per accepted task** by space
  and by agent, saying how many agents were left out for having fewer than
  three people; **Cache efficiency** per space; **Budgets** — each space's month
  and each sprint's, then tasks at 80% or more, with badges, and for a lead or
  admin a field to set a space's or sprint's budget; **Runaway-agent alerts**
  for owners and admins, a count per space and nothing else; and **Your plan
  limit**, the reader's own: plan, window (five hours rolling, a day, or a
  week with its reset), their own limit in tokens, and *at this rate you reach
  your limit around HH:MM*, marked an estimate, with the line that no plan
  publishes a token figure. **The sidebar's Usage item carries a count** of the
  reader's open alerts, none at zero. Light and
  dark; one column on a phone with nothing scrolling sideways.
- **My day** (`/my-day`, the reader's own, D-088; laid out by LAI-796, made
  for a busy day by LAI-810) — the week in the header between *previous* and
  *next*, with *Today* away from it, and while anything is drafted a confirm
  button: *Confirm day* with the drafted total when every block is ready,
  which confirms the day in one request and says so if the server's day held
  other blocks than the page; otherwise *Confirm N ready*, which confirms
  those one by one and says how many were confirmed and why the rest were
  left. The day as a bar of confirmed (solid) and drafted (dashed) blocks over
  its hours with a line at now on today, a block with no set time counted
  beneath it rather than placed. The drafted blocks ten to a page in a scroll
  area of their own, one line each with *Confirm* and a menu holding every
  other LAI-787 action; a box on each, select-all for the page and then every
  page, Shift for a run, and a bar acting on what is ticked — *Confirm
  selected*, *General*, *Not work*, *Clear* — one block at a time by id,
  leaving out and naming a block on no card, and asking before *Not work* or
  before taking blocks off their card. The confirmed entries paged the same
  way, one summary line when there are more than a page; *Add time*. Beside
  it, sticky and scrolling on its own within the viewport (under the day and
  still bounded on a phone): the **Draft my time** switch first, then **On
  your plate** — in progress, waiting on the reader's review (with CI's
  result where GitHub sent one), and blocked (naming what it waits on), at
  most five of each with the true count and *+N more* where the rest live,
  each opening in its own space — then **Agent minutes**. A card's key and
  title link to it in its own space wherever the reader can read it. A block
  from a work folder the person named (D-098, LAI-866) says the name: untied,
  it reads **Needs a card · Acme** in its row and in the inspector; under the
  project the name matched, it reads as a space block does, the name beside
  it; *Drafted from* shows the name, and the branch when sent, and its line
  then says the name went with the counts; a confirmed entry shows the name.
- **Member profile** (`/people?user=<id>`, D-078; *My profile* in the user
  menu opens the reader's own, for an owner or an admin) — owners and admins only:
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
  organisation's switch is off (with a link to Organisation) and when nothing
  has arrived yet. Context only:
  nothing on it feeds the rating. A **Tokens** card follows it, full width
  (D-084, LAI-769): tokens over 12 weeks, **at least**, with cache reads and
  the share tied to a task beside it; a bar per week; their top agents and
  models; agents with *no token data* named; and plainly when the
  organisation's switch is off or nothing has arrived. Reached from a person's name on Organisation, a Capacity card or a
  Dashboard *Contributors* row (LAI-817) — links for owners and admins, plain text for everyone
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

#### 11.4.4 Type scale

The owner, 2026-10-21: *"the text size is very small, we need to increase it
everywhere … I want the same as the Jira board."* Laika's text is set on
Atlassian's published scale, which Jira uses (LAI-828). Seven steps, each a size
and its line-height:

| Step | Size / line-height | For |
|---|---|---|
| `body` | 14px / 20px | default UI text, table cells, card titles, form fields, buttons |
| `reading` | 16px / 24px | text read like a document: a task's description, acceptance, comments; their headings are h1 24px, h2 20px, h3 16px |
| `small` | 12px / 16px | secondary lines, meta, timestamps, chips, keys, field labels, uppercase section labels |
| `tiny` | 11px / 16px | only the named badges and counters where 12px cannot fit: avatar initials in a circle under 28px, the "+N" beside a space's member stack, the folded sidebar's count |
| `heading-lg` | 24px / 28px | a page title; the task panel's title |
| `heading-md` | 20px / 24px | a section heading; a dialog title |
| `heading-sm` | 16px / 20px | a card or panel heading |

**Nothing is under 12px** but the `tiny` list. Every `font-size` in a
stylesheet is a step, written `var(--text-<step>)` with its pair
`var(--leading-<step>)`; the steps are declared once, in
`server/web/src/theme/type-roles.ts`, and generated into
`server/web/src/styles/type.css`. `type-floor.test.ts` fails on a raw size, on
anything under the floor, and on a `tiny` use not on its list.

`docs/design/` keeps the prototype's smaller sizes (D-020); this scale overrides
them in the app only.

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
- **local-activity retention** — delete `local_activity_days` rows,
  `pushed_commit_keys` and `token_usage_days` rows (D-084) dated before the day
  400 days ago (D-079), daily **and
  once at boot**, because every deploy restarts the server (D-073) and a daily
  interval may not come round. It writes no `activity` row: §4.8 has no verb
  for it, as it has none for the snapshot or the vacuum. With it, by the same
  job (LAI-773): `token_session_days` dated before 40 days ago — the
  telemetry match is settled once the collector's 31-day window has passed it
  — telemetry series not touched for three days, excluded session keys older
  than 45 days, and arrival buckets older than eight days; `agent_time_buckets`
  from before 40 days ago, the AGENTS lane's detail (LAI-833); and, kept 400
  days with the token rollup (LAI-787), `agent_time_days` and `token_session_tasks`
- **time retention** (D-088 item 11, LAI-787) — `time_drafts` dated before 30
  days ago, whatever their state, and `time_entries` dated before three years
  ago with their revisions, daily **and once at boot**, under §3.4's
  `system.time.prune`. Triggers refuse deleting a younger entry and replacing
  any (§4.48), so nothing else removes one. Solidtime's rows (§4.54) follow: a
  person's with their entry, *people not on Laika* by the same three years
  (LAI-788). With them, by the same job (LAI-831): `time_breaks` dated before
  30 days ago, as drafts are (§4.55), and `time_undo` rows older than
  `UNDO_WINDOW_MS`, two minutes, whoever's they are (§4.56). No `activity`
  row, for the reason local activity's has none
- **stale-task flagging** — `in_progress` with no heartbeat or commit for 3 days
  sets `stale_flagged_at`. **It is the one stale rule, on every screen**
  (D-092 item 4, LAI-832): every screen asks `isStale` (`board-derive.ts`) —
  `task.status !== 'done' && task.status !== 'cancelled' &&
  task.stale_flagged_at !== null` — and no screen keeps a rule of its own. The
  Dashboard's *Stale* tab and the Activity tab's Stale panel call
  `staleTasks()`, which filters by `isStale`, longest-flagged first; the List's
  amber Updated cell calls `isStale` itself
- invite expiry, meeting-review expiry (7 days)
- **claim expiry** (§4.66, §9.1.1, LAI-541) — every `LAIKA_CLAIM_SCAN_SECONDS`
  (30 s by default), each **live** claim — `active` or `paused` — whose lease has lapsed becomes
  `expired`, with one `task.claim_expired` row per claim — each is a different
  task's history — under §3.4's `system.claim.expire`. **Each claim's state
  and its row are one transaction**: both land or neither does. **Nothing lapses during
  the boot grace** (one heartbeat interval after start); the first scan after
  it catches everything overdue. Not run at boot, for the same reason
- **offer expiry and recovery** (§4.73, LAI-546) — on the claim-expiry scan's
  schedule: each live hand-off or recovery offer past `expires_at` becomes
  `expired` and a claim it paused resumes, one `task.handoff_expired` row each,
  under `system.handoff.expire`. **Recovery is part of every expiry, not of
  this scan alone**: in the same transaction that marks a claim `expired` —
  the scan's or a late heartbeat's (§9.1.1) — a task with a `verified`
  checkpoint and **no live hand-off or recovery offer** gets one **recovery**
  offer from the latest verified one, unnamed (`to_agent_id` null), one
  `task.recovered` row, under `system.handoff.recover`. A task whose expired
  claim had a live hand-off gets its recovery when that offer closes
  unaccepted, in the transaction that closes it; an expired recovery is
  replaced the same way while the task's newest claim is still `expired`. The
  old holder may still reclaim until somebody accepts (§9.1.1). **Offered,
  never assigned**; a task with no verified checkpoint gets no offer
- **checkpoint retention** (§4.70, D-115 item 9, LAI-545) — daily: checkpoints,
  their refs and those refs' transitions, of tasks `done` or `cancelled` more
  than 90 days — closed offers that named them keep `checkpoint_commit_sha`
  and lose the link (§4.73) — and transitions for a ref name **never
  registered**, 90 days after they arrived; under `system.checkpoint.prune`. It writes no `activity` row: the
  `task.checkpoint_saved` rows naming them stay, and they are the history
- **estimate refit** (D-085) — every live project's size model fitted again
  from its history and every open task recomputed against it, daily **and once
  at boot**, so a deploy starts with every task estimated. It writes no
  `activity` row: the figures are derived, as `ready` is
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
| `LAIKA_CLAIM_HEARTBEAT_SECONDS` | `30` | §9.1.1: how often an agent session is expected to heartbeat, and the boot grace. Whole seconds, 1–86400 |
| `LAIKA_CLAIM_SUSPECT_SECONDS` | `90` | §9.1.1: a session silent this long is shown suspect |
| `LAIKA_CLAIM_EXPIRE_SECONDS` | `300` | §9.1.1: a claim's lease. **Must be longer than the heartbeat** — a startup failure otherwise, since every claim would lapse between heartbeats |
| `LAIKA_CLAIM_SCAN_SECONDS` | `30` | §11.6: how often the claim-expiry scan runs |

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

**Sessions last 30 days idle and renew once a day of use** (LAI-811). A
remembered session's expiry is 30 days out. The first `/api/` request on a
session older than a day slides it back to 30 days and re-sends the cookie with
the full `Max-Age`; in practice that is the `/api/v1/me` the SPA makes on load,
so the cookie catches up on the first page load after a day away. **Renewal rides
on API responses only, and they are `Cache-Control: private, no-store`.** Static
files and the SPA document neither renew the session nor carry a session cookie,
not even the expiring one for a dead session, because those are the responses a
shared cache may keep. "Keep me signed in" starts ticked; unticked, the session
is a fixed 24 hours and the cookie lasts as long as the browser session does.
Bearer tokens are unaffected and never receive a cookie.

**The trade-off, stated because it is the owner's to know:** the cookie is
`Secure` only when `LAIKA_PUBLIC_URL` is `https://`. Until HTTPS lands, the
session cookie and every sign-in's password cross the network in clear, and a
30-day session is a 30-day replay window for anyone who captures the cookie.
TLS is the real fix. Turning it on adds the `__Secure-` prefix to the cookie's
name, which signs everyone out once.

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

**Local activity counts are inbound, the organisation's choice, and counts
only** (D-079; D-102 amended). A developer's connected machine sends per-day
counts to their own board — only while the organisation's *Developer insights*
is on, and the developer is told so wherever they look (Developer access,
Connect, the CLI) — and nothing leaves the deployment. Never prompt text, file
names, repository names or paths, remote URLs, branch names, commit messages,
author emails or raw commit ids. No call to GitHub is added.

**OpenTelemetry is inbound too, and metrics only** (LAI-773, D-087). A
developer may point their own Claude Code's metrics at their own board, with
their own token, under the same switch; Laika keeps the counts of the
metrics §6.4 names and a one-way key of the session, drops every other
attribute, and has no route for logs or traces. **Prices are a dated table in
the code**, edited by an admin; nothing fetches one. The plan-limit forecast is
computed from what the board already holds and shown to the developer alone.

**Time drafts are inbound too, opt-in twice, and blocks with counts only**
(D-088, LAI-787): a person's own collector drafts their day on their machine
and sends only start, end, the local day and zone, a task key or none, the
counts of the signals behind each block, which five minutes its prompts and
commits fell in (D-096), and the name the person gave the block's work folder
on their machine, with its branch only if they turned that on (D-098) — never
prompt text, paths, a folder's own name, repository names, a branch they did
not turn on, commit messages or window titles — to a store only they read,
signed in. The name and branch reach owners and admins only on an entry the
person confirmed, which they can change or clear before then.

**Solidtime is reached by the person's CLI, never by the board** (D-088 item
10, LAI-788). The developer's own Solidtime URL and key stay in a `0600` file
on their machine and are never sent to Laika; the CLI writes their confirmed
entries to Solidtime and brings back what they logged there, sending the
board start, end, a key read from each description and a digest — never the
description, never a rate or an amount.

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
