# Laika — Decision log

Append-only. Newest at the bottom. If a decision is reversed, add a **new**
entry that supersedes the old one and mark the old one `Superseded by D-0XX` —
never edit history. Only PM writes here; builders propose via a task or a log
entry.

Format: context → decision → consequences → revisit trigger.

---

## D-001 — SQLite only for v1
**Date:** 2026-08-24 · **Status:** accepted

**Context.** Laika is self-hosted by small teams. The obvious alternative is
Postgres, which every hosted tracker assumes. Supporting both from day one means
two schema dialects, two test matrices, and a docker-compose with a database
service in it.

**Decision.** SQLite only, in WAL mode, accessed exclusively through Drizzle. One
file at `/data/laika.db`.

**Consequences.** Backup is copying a file. There is no connection pool, no
network hop, and no separate service to fail. Writes serialise — acceptable at
our scale (tens of users, agent traffic measured in requests per minute, not per
millisecond). We give up concurrent-writer throughput and Postgres-only features
(`LISTEN/NOTIFY`, rich JSON operators, real full-text without an extension); the
SSE design in D-003 already assumes we do not have `LISTEN/NOTIFY`. Going
through Drizzle means a future Postgres port is a dialect swap plus a migration
rewrite, not an application rewrite.

**Revisit when:** sustained write contention shows up as `SQLITE_BUSY` in logs,
or a deployment needs more than one Laika process.

---

## D-002 — Single container, single process
**Date:** 2026-08-24 · **Status:** accepted

**Context.** The API, the SPA, the MCP endpoint, the webhooks, and the scheduled
jobs could each be their own service. Every one we split adds a deployment step
for someone self-hosting on a $5 VPS.

**Decision.** One Docker image running one Node process that serves all of it.
One writable volume at `/data`. No queue, no cache server, no worker.

**Consequences.** `docker run` with one volume is the whole install, and backup
is one directory. Cron runs in-process (SPEC §10.6), so a restart briefly stops
scheduled work — jobs are idempotent, so that is survivable. Scaling is vertical
only, and a crash takes everything down together; that is the correct trade for
a tool whose users are a team, not a platform. Long or CPU-heavy work must not
block the event loop — LLM calls (§9.2) are the risk to watch.

**Revisit when:** transcript processing or another job starves request handling.

---

## D-003 — SSE over WebSockets for live updates
**Date:** 2026-08-24 · **Status:** accepted

**Context.** The board must update without refreshing. Our traffic is
overwhelmingly server→client: someone changed a task, everyone else should see
it. Client→server already has a perfectly good REST API.

**Decision.** Server-Sent Events at `GET /api/v1/events`. No WebSocket layer.

**Consequences.** It is plain HTTP — it works through every reverse proxy, it
carries our existing cookie/Bearer auth with no second auth path, it reconnects
automatically, and `Last-Event-ID` gives us gap recovery for free (falling back
to `?updated_since=`, which we need for agents anyway). We accept one long-lived
connection per client and the old HTTP/1.1 six-connection cap (a non-issue over
HTTP/2). If we later need genuinely bidirectional, low-latency features —
collaborative text editing, cursors — SSE will not carry them.

**Revisit when:** a feature needs sub-100ms client→server streaming.

---

## D-004 — Invite-only signup by default
**Date:** 2026-08-24 · **Status:** accepted

**Context.** A self-hosted board is usually reachable from the internet. A
default-open signup form on a box someone spun up in five minutes is how
strangers end up in your backlog.

**Decision.** `orgs.signup_mode` defaults to `invite_only`. The first-run wizard
creates exactly one Owner; everyone else arrives through an invite with a
hashed, expiring token and a role assigned up front. `open` exists as an
explicit Owner choice.

**Consequences.** Onboarding costs an invite step, and we must build invite
send/accept/expire in M2 rather than deferring it. In exchange, the insecure
default does not exist, and role assignment happens at invite time instead of
being a thing someone forgets to do afterwards.

**Revisit when:** a deployment pattern appears where SSO/domain-restricted open
signup is safe and wanted.

---

## D-005 — Heartbeats carry metadata only
**Date:** 2026-08-24 · **Status:** accepted

**Context.** Presence and capacity need to know who is working on what. The
richest possible signal — files touched, diffs, prompt text — is sitting right
there in the agent session, and it would make the dashboard much smarter.

**Decision.** A heartbeat carries `{ repo, branch, timestamp }` and nothing
else. The task link is *derived* from the branch name (`lai-42-slug`), not
reported. No file paths, no diffs, no prompts, no transcript content, ever.
Retention is 30 days, pruned by cron. Paired with SPEC §12.4: no telemetry of
any kind leaves the deployment.

**Consequences.** We can answer "who is active, on which task, since when" and
we cannot answer "what exactly were they typing" — correct, because the second
question makes Laika surveillance software and would poison the trust the
product depends on. Branch naming becomes a real convention, and unparseable
branches degrade to a plain string rather than erroring. Any future feature
wanting richer session data needs a new decision entry and an explicit,
per-user, opt-in mechanism — not an extension of this endpoint.

**Revisit when:** never, without an explicit opt-in design.

---

## D-006 — Two-level role model: org role plus project role
**Date:** 2026-08-24 · **Status:** accepted · **Supersedes** the flat four-role
model in the original SPEC §3

**Context.** The first spec gave each user one role, held per project. That
collapses two genuinely different questions into one: "may this person create
projects and invite people" is an organisation question, while "may this person
edit tasks on *this* board" is a project question. With one role you either
over-grant (a task-editing Member can also invite strangers) or you bolt on
special cases until the matrix is unreadable.

**Decision.** `users.org_role` (`owner` | `admin` | `member` | `viewer`) gates
global actions. `project_memberships.role` (`lead` | `member` | `viewer`) gates
work inside a board. Org `owner`/`admin` hold implicit `lead` everywhere and
bypass the membership check. A user whose org role is `viewer` may hold only the
project role `viewer` — no escalation by being added to a project.

**Consequences.** Two matrices to maintain (SPEC §3.1, §3.2) and two lookups in
`can()`, which stays pure because the caller resolves both before calling. In
exchange, `lead` finally has somewhere to live — per-project ownership of members
and the context doc — without inventing a fifth org role. The no-escalation rule
is the part most likely to be forgotten; it is enforced in code and must have its
own test.

**Revisit when:** a deployment needs per-project roles that org admins should
*not* override.

---

## D-007 — Agents never self-certify work as done
**Date:** 2026-08-24 · **Status:** accepted

**Context.** The obvious MCP surface is symmetric: if an agent can move a task to
`in_progress`, it can move it to `done`. An agent that finishes its own work,
marks it done, and picks up the next task is also an agent whose mistakes close
silently and are found weeks later.

**Decision.** `finish_task` moves a task to **`review`** and posts the agent's
summary as a comment. It cannot set `done`. Closing is a human or PM action,
through the UI or `update_status`. The same asymmetry exists in this repo's own
workflow: builders move task files to `.tasks/review/`, only PM moves them to
`.tasks/done/`.

**Consequences.** Every piece of agent work passes a human gate, so the review
queue becomes the bottleneck — that is the intended cost, and the capacity view
(SPEC §9.3) surfaces it rather than hiding it. Agents cannot run unattended
end-to-end, which is the point. Pairs with §10.2, where LLM-proposed board
changes also require explicit human acceptance: **an LLM may propose, a human
disposes.**

**Revisit when:** never for `done`. A future auto-close for a narrow, provably
verifiable class of task (say, a green CI run on a task whose only criterion is a
passing test) would be a new entry, not an extension of this one.
