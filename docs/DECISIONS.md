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
