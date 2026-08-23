# Laika — Decision log

Append-only. Newest at the bottom. If a decision is reversed, add a **new**
entry that supersedes the old one and mark the old one `Superseded by D-0XX` —
never edit history. Only PM writes here; builders propose via a task or a log
entry.

Format: context → decision → consequences → revisit trigger.

**Amendment, 2026-08-24.** Every entry below was expanded in place with an **In
one line** framing and, where it was missing, the reasoning behind the rule
rather than just the rule. **No decision, status, or outcome was changed** — the
append-only guarantee covers what was decided, and that is intact. This was done
because the original design conversation happened somewhere that will not
survive, and a rule whose reasoning is lost gets re-litigated or quietly
abandoned the first time it is inconvenient.

Cross-references into `docs/SPEC.md` are also corrected in place when the spec
renumbers — D-011 makes that the renumberer's obligation, and it applies to this
file too. Those are pointer fixes, not decision changes: D-002's `§10.6` became
`§11.6` and D-005's `§12.4` became `§13.4` on 2026-08-24, both pointing at the
same text they always meant. Where a *field name* changed rather than a section
number, the correction is written as a new paragraph instead — see D-011's note
on D-004's `orgs.signup_mode`.

---

## D-001 — SQLite only for v1
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** one file means data sovereignty and a backup a human can actually perform.

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

**The deeper reason.** Data sovereignty is a feature of this product, not a
side effect (`VISION.md` §6.4). A team self-hosts Laika because they do not want
their project context on someone else's infrastructure — and "your data is yours"
is a hollow promise if getting it out means `pg_dump` credentials and a running
service. One file at a known path means the answer to "how do I back this up" is
`cp`, and the answer to "how do I leave" is "take the file". A database server
would make both of those a procedure instead of a fact.

**Revisit when:** sustained write contention shows up as `SQLITE_BUSY` in logs,
or a deployment needs more than one Laika process.

---

## D-002 — Single container, single process
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** setup *is* the product — a self-hosted tool that takes an afternoon to stand up does not get stood up.

**Context.** The API, the SPA, the MCP endpoint, the webhooks, and the scheduled
jobs could each be their own service. Every one we split adds a deployment step
for someone self-hosting on a $5 VPS.

**Decision.** One Docker image running one Node process that serves all of it.
One writable volume at `/data`. No queue, no cache server, no worker.

**Consequences.** `docker run` with one volume is the whole install, and backup
is one directory. Cron runs in-process (SPEC §11.6), so a restart briefly stops
scheduled work — jobs are idempotent, so that is survivable. Scaling is vertical
only, and a crash takes everything down together; that is the correct trade for
a tool whose users are a team, not a platform. Long or CPU-heavy work must not
block the event loop — LLM calls (§9.2) are the risk to watch.

**The deeper reason.** For our users, **setup is the product.** The audience is
small teams who self-host by preference or policy (`VISION.md` §3) — people who
will evaluate Laika on a spare VPS on a Thursday evening. Every service in the
compose file is a place that evaluation stops. A tool that needs Postgres plus
Redis plus a worker plus a reverse proxy is not a tool those teams adopt; it is a
project they mean to get to. One image and one volume is not minimalism for its
own sake — it is the difference between being tried and not.

**Revisit when:** transcript processing or another job starves request handling.

---

## D-003 — SSE over WebSockets for live updates
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** SSE is proxy-friendly and carries our existing auth; WebSockets buy bidirectionality we do not need.

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

**The deeper reason.** Proxy-friendliness is the whole argument. Our users put
Laika behind whatever they already run — Caddy, nginx, Traefik, a corporate load
balancer they do not control. WebSockets need an upgrade path that some of those
break silently, and a second authentication story because cookies and Bearer
tokens do not travel the same way over a socket. SSE is an HTTP response that
never ends: existing auth works unchanged, every proxy understands it, the
browser reconnects on its own, and `Last-Event-ID` gives gap recovery for free.
We are trading a capability we do not need for deployments that do not break.

**Revisit when:** a feature needs sub-100ms client→server streaming.

---

## D-004 — Invite-only signup by default
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** this is an org tool on someone's own box — the insecure default must not exist.

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

**The deeper reason.** Laika is an **organisation's internal tool that happens
to be internet-reachable**, not a product with a signup funnel. Those two things
want opposite defaults. A SaaS tracker defaults to open because growth is the
goal; a self-hosted org tool defaults to closed because the people who belong in
it are already known, and everyone else is an intruder. Since the box is usually
reachable from the internet the moment it is stood up, an open default is not a
convenience with a security cost — it is a vulnerability with a convenience
excuse. Invite-only also puts role assignment at the invite, where the inviter is
already thinking about it, instead of leaving it as a step someone forgets.

**Revisit when:** a deployment pattern appears where SSO/domain-restricted open
signup is safe and wanted.

---

## D-005 — Heartbeats carry metadata only
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** capacity, not surveillance. We refuse the richer signal on purpose.

**Context.** Presence and capacity need to know who is working on what. The
richest possible signal — files touched, diffs, prompt text — is sitting right
there in the agent session, and it would make the dashboard much smarter.

**Decision.** A heartbeat carries `{ repo, branch, timestamp }` and nothing
else. The task link is *derived* from the branch name (`lai-42-slug`), not
reported. No file paths, no diffs, no prompts, no transcript content, ever.
Retention is 30 days, pruned by cron. Paired with SPEC §13.4: no telemetry of
any kind leaves the deployment.

**Consequences.** We can answer "who is active, on which task, since when" and
we cannot answer "what exactly were they typing" — correct, because the second
question makes Laika surveillance software and would poison the trust the
product depends on. Branch naming becomes a real convention, and unparseable
branches degrade to a plain string rather than erroring. Any future feature
wanting richer session data needs a new decision entry and an explicit,
per-user, opt-in mechanism — not an extension of this endpoint.

**The deeper reason.** The distinction is **capacity, not surveillance**, and
it is the sharpest line in the product. Capacity answers "who is free, what is
stuck, where is this work" — a question about the *board*. Surveillance answers
"what was this person doing" — a question about the *person*. Repo, branch and
timestamp answer the first completely and the second not at all, which is exactly
why that is the payload.

The richer signal is sitting right there in the session and would genuinely make
the dashboard smarter. We refuse it because the day an engineer suspects Laika is
monitoring them is the day heartbeats get turned off, and once heartbeats are off
the capacity view — the feature the whole product bets on (`VISION.md` §4b) — is
dead. The privacy stance is not in tension with the product; it is load-bearing
for it.

**Revisit when:** never, without an explicit opt-in design.

---

## D-006 — Two-level role model: org role plus project role
**Date:** 2026-08-24 · **Status:** accepted · **Supersedes** the flat four-role

**In one line:** "may you create projects" and "may you edit tasks on this board" are different questions and need different answers.
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

**In one line:** no self-certification — an LLM may propose, a human disposes.

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

**The deeper reason.** An agent that closes its own work is an agent whose
mistakes close silently. The failure is not that agents are unreliable — humans
are too — it is that a self-certified `done` produces **no artefact anyone
reviews**. The error is discovered weeks later by whoever depends on it, with no
record of what was checked.

Stopping at `review` is one instance of a rule that runs through the whole
product: **an LLM may propose, a human disposes.** Meeting diffs require
line-by-line acceptance (§10.2). Any future Laika Assistant that writes to the
board inherits the same gate. Agents generate; humans commit. That asymmetry is
what makes the board trustworthy enough to be worth sharing with agents at all —
without it, the "single source of truth" becomes a single source of unreviewed
machine output.

**Revisit when:** never for `done`. A future auto-close for a narrow, provably
verifiable class of task (say, a green CI run on a task whose only criterion is a
passing test) would be a new entry, not an extension of this one.

---

## D-008 — One git worktree per session, one branch per session
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** a shared working tree gave three sessions one index, so the claim lock was never a lock.

**Context.** The bootstrap workflow assumed three sessions could share one
checkout of `master`, with the `git mv` of a task file acting as the claim lock.
That assumption failed within the hour. A shared working tree has one index and
one set of unstaged changes, so `git add -A` in any session stages **every**
session's in-flight work; it happened twice on day one, once to PM, sweeping both
builders' uncommitted work into a commit describing neither. Worse, the lock was
never a lock: two sessions can `git mv` the same file in the same tree and only
discover it at commit time, or not at all — Builder-A's LAI-001 claim commit
carried Builder-B's LAI-012 move along with it.

The obvious fix — a worktree per session, all on `master` — is impossible: git
refuses to check out one branch in two worktrees, and for good reason. Committing
in one would move the ref out from under the other.

**Decision.** One worktree **and one branch** per session: PM in `Laika/` on
`master`, Builder-A in `Laika-builder-a/` on `builder-a`, Builder-B in
`Laika-builder-b/` on `builder-b`. All three are worktrees of a single
repository, so they share one object database and one set of refs. Builders merge
`master` in to stay current and never merge out; **PM is the sole integrator**,
merging a builder branch with `--no-ff` when accepting the task.

The claim check moves from "look in the working tree" to "look across all refs":

```bash
git log --all --oneline -- '.tasks/in-progress/LAI-00X*' '.tasks/review/LAI-00X*'
```

**Consequences.** Isolation is real — an `add -A` accident is now confined to the
session that made it. The claim check is *better* than before, not worse: because
the worktrees share one `.git`, a claim commit is visible to every session the
instant it exists, with nothing to fetch and no window where one session's claim
is invisible to another. In exchange, `master` no longer shows in-flight work, so
PM's `/standup` must read `--all` rather than the working tree, and integration
becomes an explicit step PM owns — which it effectively already was, since only
PM moves tasks to `done`. A simultaneous-claim race is still possible in the
seconds between two commits; the tie-break is the earlier commit timestamp, and
the loser releases (CLAUDE.md §2). Separate branches also mean a builder can be
several commits behind `master`; merging before each claim is now protocol, not
courtesy.

**Revisit when:** the session count grows past three, or integration latency
starts blocking builders more than the isolation is worth.

---

## D-009 — The LLM provider is org-configured, or absent
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** the org points Laika at a model it already trusts, so project
data never leaves infrastructure they control.

**Context.** Laika needs a model for exactly one feature: turning a meeting
transcript into a proposed board diff (§10.2). The convenient design is the one
every SaaS uses — we hold an API key, we make the call, the customer never thinks
about it. For a self-hosted tool sold on data ownership, that design is
self-defeating: it means the *one* thing a team most wants to keep private, the
substance of what they discussed, is the one thing that leaves their network, to
a vendor they never chose, on a key they cannot see.

**Decision.** The org configures its own provider, or none. `anthropic` with the
org's own API key, or `openai_compatible` with a base URL — which covers Ollama
and vLLM, so a team that wants nothing leaving the building can point at a model
on their own hardware. Default is `null`. **Laika is fully functional with no LLM
configured**; only the meeting diff is unavailable. Credentials are encrypted at
rest with AES-256-GCM under a key derived from `SERVER_SECRET`, never logged,
never returned by the API, never written to `activity`.

**Consequences.** We ship no default model, so the meeting-diff feature has an
onboarding step and will be unused by teams who never take it. That is the right
trade: the alternative is a feature that works out of the box by quietly
exfiltrating standup transcripts. It also means we cannot rely on a specific
model's behaviour — the strict-JSON proposal contract (§10.2) has to be robust
against a small local model as well as a frontier one, and must fail visibly
rather than silently produce bad proposals. Supporting an OpenAI-compatible shape
alongside Anthropic's is a small, permanent maintenance cost.

Combined with **no telemetry** (SPEC §13.4), this makes the outbound-traffic
story complete and auditable: the only packets Laika ever sends are to a provider
the org configured, an SMTP server the org configured, and a webhook source the
org configured. There is no fourth category, and anyone can verify that.

**Revisit when:** never for the principle. A bundled default provider would be a
different product.

---

## D-010 — Humans and agents share one source of truth
**Date:** 2026-08-24 · **Status:** accepted · **Founding thesis**

**In one line:** one record that a human plans in and an agent works from —
everything else in this file is downstream of that.

**Context.** This is the decision Laika exists to express, recorded late only
because it was assumed rather than argued. It is written down now because it is
the one that makes the others cohere, and the design conversation it came from is
not durable.

The alternatives were both easier to build:

1. **Agent memory, no humans** — issues as files in the repo, agent-native, no
   server. Beads does this well. But a manager cannot read it, a designer cannot
   file into it, and there is no answer to "where are we".
2. **A tracker with an AI integration** — a normal board, plus an API an agent
   can call. Plane or Jira plus a bot. But the agent arrives as a foreign client
   on a service account, so its permissions are ungovernable, and the data model
   has sprints and story points and no notion of *ready*.

**Decision.** One database, two first-class front doors: a web UI for people and
an MCP endpoint for agents, over **identical data and identical permissions**.
Agents are users, not integrations — an agent acts through a real person's token,
under that person's role, and every action it takes writes the same `activity`
row a human's would, marked `actor_kind: 'agent'`.

**Consequences.** This is what forces most of the rest of this file.

- Because an agent acts *as* a user, `can()` must be one module both paths call —
  not a policy layer plus an integration allowlist (§3.3).
- Because both write the same records, MCP tools are thin wrappers over the same
  service layer as REST, and parity is a tested property (§13.3).
- Because agents write to a shared board, they cannot self-certify — D-007.
- Because the board must be true without anyone updating it, presence is derived
  from heartbeats rather than status fields — D-005, `VISION.md` §4b.
- Because the *same* context should reach every teammate's agent, project context
  is a first-class document rather than everyone's private `NOTES.md` —
  `VISION.md` §4d.

The cost is that we can never take the shortcut of a service account or an
agent-only write path, however much simpler it would make a given feature. Every
capability has to work for both audiences or it does not ship.

**This is the bet.** Not any single feature — the integration
(`VISION.md` §5.1). If it is wrong, it is wrong because teams would rather run a
pure agent memory alongside a pure tracker, and the seam between them turns out
not to matter. The capacity view is the early signal: it is the feature that
cannot exist unless everything is in one place.

**Revisit when:** never. Reversing this is starting a different project.

---

## D-011 — The spec is authoritative; task files cite it, never restate it
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** when a task file and the spec disagree, the spec wins — and the
reason they disagreed is that the task file had copied the spec instead of
pointing at it.

**Context.** `docs/SPEC.md` was rewritten while twelve task files were already
written against it. The rewrite renumbered every section after §7 and renamed
several fields. The damage was not that references broke loudly — it is that they
broke **silently**: LAI-002 told a builder to implement "the SPEC §10.2
middleware order", and §10.2 still existed, but it was now part of *Webhooks and
the meeting diff*. A builder following the reference would have read a real
section and implemented the wrong thing.

Worse, four disagreements were substantive rather than positional, because task
files had restated spec content instead of citing it: project identity (`key` vs
`slug`+`prefix`), signup mode (`signup_mode` enum vs `invite_only` flag), the
role model (flat vs two-level), and the `ready` computation (which silently
omitted the new `todo` status).

**Decision.**

1. **`docs/SPEC.md` is authoritative for M1–M7.** Where a task file and the spec
   disagree, the spec wins and the task file is corrected — never the reverse,
   and never by a builder mid-task.
2. **Task files cite the spec; they do not restate it.** A task may quote a
   constraint for emphasis, but the citation is the contract. Restating a field
   name or an enum creates a second source of truth that will drift.
3. **Renumbering the spec is a breaking change** and obliges whoever does it to
   fix every `§` reference in `.tasks/**` in the same task.
4. **Prefer stable anchors to numbers.** Cite `§4.5` *and* name the thing —
   "SPEC §4.5 (`tasks`)" survives a renumber with a recoverable error; a bare
   `§4.5` does not.

**Consequences.** Task files get slightly less self-contained: a builder must
open the spec rather than working from the task alone. That is the intended
trade — the alternative is what happened here, where the task was self-contained
and wrong. It also makes spec edits more expensive, which is correct: a document
twelve tasks depend on should not be cheap to renumber.

The four naming conflicts were resolved spec-wins and the task files rewritten;
LAI-015 carries the table. Note that **D-004's text still says
`orgs.signup_mode`** — that entry is append-only and its decision (invite-only by
default) is unchanged; only the field name moved, to `orgs.invite_only`. This
paragraph is the correction rather than an edit to D-004.

**Revisit when:** never for the principle. The mechanics could improve — a link
checker in CI would catch dangling `§` references before a builder does.

---

## D-012 — A screen is specified by its endpoints, or it is blocked
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** no UI is built against an API that does not exist yet, and a
screen with no backing endpoint is a blocked task rather than a stubbed one.

**Context.** Eleven screens were designed before the API surface was complete. A
coverage pass (SPEC §11.4.2) found nine fully covered once six missing endpoints
were added, and two — Timeline and Sprints — with no possible backing at all.

The tempting move with those two is to build the screen against mock data and
"wire it up later". That is how a stub ships: the screen looks finished, it
demos, nobody can tell from the outside that the numbers are invented, and the
task closes. The API then gets shaped backwards to fit a UI that was designed
without it.

**Decision.**

1. **A UI task carries `depends-on` for the API task(s) defining its endpoints.**
   Enforced by the ordinary claim protocol: dependencies must be in
   `.tasks/done/` before the task is claimable, so the ordering is mechanical
   rather than remembered.
2. **A screen whose endpoints are undefined stays in `.tasks/backlog/`.** It is
   not started, not stubbed, not mocked.
3. **A UI task never adds an endpoint.** Discovering a missing one means filing a
   task for the API (`discovered-from`), not widening the current one.
4. **The screen → endpoint map lives in SPEC §11.4.2** and is updated whenever a
   screen or an endpoint is added. A screen absent from that table is not
   scheduled.

**Consequences.** Front-end work is gated behind back-end work, so the UI cannot
run ahead — the cost is real, and on a two-builder team it means Builder-B waits
on Builder-A more than the reverse. Accepted, because the alternative is a
convincing-looking product built on invented data, which is worse than a slower
honest one. It also forces API gaps to surface at design time: this pass found
six missing endpoints and one missing table (`unlisted_work`, §4.14) that nobody
would have noticed until a screen needed them.

The two blocked screens are blocked on **decisions**, not endpoints (SPEC §14,
questions 9 and 10) — planned dates for Timeline, and reversing the sprints
non-goal for Sprints. Neither is a gap PM can close by writing an endpoint.

**Revisit when:** never for the principle. If UI-ahead-of-API becomes necessary
for a design review, that is a throwaway prototype outside `.tasks/`, not a task.

---

## D-013 — Sprints ship in v1, Phase 2
**Date:** 2026-08-24 · **Status:** accepted · **Reverses** the "sprints" entry in SPEC §1.1

**In one line:** sprints are how the target team already plans, and a board they
cannot plan in is a board they keep a second tool beside.

**Context.** §1.1 listed "sprints or story points" as a v1 non-goal, on the
reasoning that agent-era work is continuous-flow and iteration ceremony is
overhead. That reasoning describes how *agents* work. It does not describe how
the humans in a 3–30 person org work, and Laika's whole thesis (D-010) is that
both share one board. A board that models the agent's reality and not the
manager's is half a product — the manager keeps a spreadsheet, and the spreadsheet
becomes the real plan.

**Decision.** Sprints are in, at **Phase 2**, alongside the board they organise:
a `sprints` table (§4.15), `tasks.sprint_id`, CRUD endpoints, and a Sprints
screen. Constraints that keep it small: at most one `active` sprint per project,
no overlapping date ranges within a project, completing a sprint never touches
its tasks' statuses, and deleting one never deletes tasks.

**What did not come with it.** **Story points remain a non-goal.** A sprint here
carries dates and a goal, not a velocity model — no estimates, no burndown, no
capacity-in-points. The `/capacity` view (§9.3) answers "who is free" from
heartbeats and in-progress counts, which is a measurement rather than an
estimate, and is the better answer. Reversing the points half of the original
non-goal would need its own entry.

**Consequences.** Phase 2 grows: a table, six endpoints, a screen, and a
`?sprint=` filter on the task list. `tasks.sprint_id` is nullable and null is the
normal state, so nothing in the existing model has to change and no migration
backfills anything. The non-overlap constraint is what makes the Phase 2.5
timeline nearly free (D-014) — it is worth defending even when someone asks for
overlapping sprints.

The honest cost: this is the first time a stated non-goal has been reversed. The
non-goal list is a promise about scope, and reversing one cheaply is how a
focused product becomes Jira. It was reversed here because the original reasoning
was wrong about the audience, not because sprints are convenient.

**Revisit when:** a team runs Laika for a full quarter without creating a sprint.

---

## D-014 — The timeline is sprint-based; tasks never get dates
**Date:** 2026-08-24 · **Status:** accepted · **Reverses** the "Gantt charts" entry in SPEC §1.1

**In one line:** draw the Gantt from sprint boundaries, and it costs a view;
draw it from task dates, and it costs a scheduling engine.

**Context.** A Timeline screen was designed, and the obvious implementation gives
each task a planned start and a due date. That is also the expensive one: task
dates imply dependency-aware layout, a critical path, what happens when a
dependency slips, and a scheduling model that has to be maintained forever. It is
why "Gantt charts" was a non-goal.

Sprints (D-013) make the cheap version available. Sprints already have
`starts_on` and `ends_on`, and §4.15 forbids them from overlapping within a
project — so the time axis is a single clean track with one bar per sprint and no
layout problem to solve.

**Decision.** The timeline (§11.4.3) is a **sprint** chart, at **Phase 2.5**,
immediately after sprints. Sprints are bars; tasks are contents. **Tasks have no
bars and no dates** — `due_date` and `planned_start` stay non-goals in §1.1
specifically to protect this boundary. `GET /projects/:slug/timeline` returns
sprints with their ranges and tasks; dragging a sprint edge is a `PATCH` on the
sprint, rejected if it would overlap a neighbour.

**Consequences.** The user gets the Gantt-style view they wanted for roughly the
cost of a rendering pass over data that already exists. Precision is bounded by
sprint granularity: you can say "this work is in the sprint ending the 14th", not
"this task is due Tuesday". For a 3–30 person team that is the right resolution —
day-level task deadlines on a board that also tracks agent sessions is a
precision nobody meets.

**The failure mode to watch for** is incremental: someone adds `due_date` "just
for the timeline", and the sprint chart quietly becomes a task Gantt with a
layout engine. Any proposal to put dates on tasks reopens this decision
explicitly — it is not a small additive change.

**Revisit when:** teams consistently need sub-sprint scheduling precision.

---

## D-015 — Nothing is cut; the backlog is sequenced, not trimmed
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** every feature in `FEATURES.md` is scheduled to a phase — the
answer to "are we building X" is a date, never "no".

**Context.** Faced with two screens that did not fit v1, the reflex was to drop
them. The owner's call was the opposite: build everything, in order. That is a
different discipline, not a weaker one — it holds only if "later" is a real
position with a phase attached, rather than a polite refusal.

**Decision.** All eleven designed screens are in the plan (§11.4.2), each tagged
with its phase. Everything in `FEATURES.md` carries a phase. `[idea]` now means
**"scheduled, scope not yet decided"**, not "may never happen" — and an `[idea]`
must name the questions blocking it, so the difference between *undecided* and
*unexamined* stays visible.

**Laika Assistant is Phase 6**, alongside meeting intelligence, with three
questions due before it can be written as tasks: read-only versus can-mutate,
provider strategy, and context scope (SPEC §14, question 9). It appears in the
screen table with no endpoint column — scheduled, and visibly unspecified.

**Consequences.** Nothing gets quietly forgotten, and the roadmap becomes the
single answer to "what about X". The risk is the mirror image of cutting: a
backlog where everything is promised is one where nothing is prioritised, and
`FEATURES.md` grows into a wish list that no phase can absorb. The guard is that
a phase has an exit test — work that does not serve the current exit test waits,
however scheduled it is.

This also means **D-012 does more work than before**: with every screen scheduled,
the gate that stops a screen being built ahead of its endpoints is the only thing
keeping "everything is in" from meaning "anything may start".

**Revisit when:** a phase cannot absorb its own scope and something has to give.

---

## D-016 — `server/web/` belongs to Builder-B; the split is API versus UI
**Date:** 2026-08-24 · **Status:** accepted · **Amends** the ownership table in CLAUDE.md §1

**In one line:** the frontend is a separate job from the API, so it gets a
separate owner — otherwise the UI can only ever be built after the API, by the
same person, one thing at a time.

**Context.** SPEC §11.4 puts the SPA source at `server/web/`, inside `server/`,
which CLAUDE.md §1 gave entirely to Builder-A. That was fine while `server/` was
only an API. It stops being fine the moment there is a designed thirteen-screen
UI: every screen would queue behind Builder-A, who is also building the database,
the policy module, the MCP endpoint and the webhooks.

Meanwhile Builder-B — owning `plugin/`, `cli/` and `docker/` — has been blocked
for most of Phase 1 waiting on LAI-001 and LAI-002, and logged exactly that.

**Decision.** `server/web/` is **Builder-B's**. The rest of `server/` stays
Builder-A's. The boundary is **API versus UI**, not directory depth: Builder-B
never touches `server/src/`, Builder-A never touches `server/web/`.
`server/public/` is build output, gitignored, and owned by nobody (LAI-016).

**Consequences.** The two builders can work the same phase in parallel — API and
UI — which is what makes the shell tasks (LAI-017…LAI-021) startable now instead
of after Phase 1. The cost is that one directory tree has two owners, so the
merge surface between the branches is larger than "different top-level folders",
and a task touching both sides of the line has to be split into two tasks.

It also puts real weight on D-012: with a dedicated UI builder who is never
blocked on their own area, the temptation to start a screen before its endpoints
exist goes up, not down. The `depends-on` gate is the only thing holding that
line.

**Rejected alternative:** moving the frontend to a top-level `web/`. Cleaner
ownership, but it contradicts SPEC §11.4, breaks LAI-007's paths, and changes the
Docker build context for LAI-008 — three tasks disturbed to avoid one sentence in
an ownership table.

**Revisit when:** the frontend outgrows one builder, or the merge surface between
`server/src/` and `server/web/` starts producing conflicts.

---

## D-017 — Each session issues task ids from its own range
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** "next unused number" is a read-then-write race, so give each
session its own numbers and the race disappears.

**Context.** Task ids collided **twice on day one**. Builder-A filed
LAI-017/018/019 from LAI-002 while PM was writing LAI-017–021 for the UI shell;
Builder-A had to renumber to LAI-022/023/024 after the fact. Both sessions
followed the rule exactly — the rule was wrong. "Take the next unused number"
requires reading the current maximum and then writing, and nothing holds between
those two steps. It is the same class of bug as the task claim itself, which is
why the claim is a `git mv` and not a status field.

Worktree isolation (D-008) made it *more* likely, not less: sessions no longer
see each other's uncommitted files at all, so the read half of read-then-write
got staler.

**Decision.** Static ranges, allocated per session:

| Session | Range |
| --- | --- |
| PM | `LAI-001` – `LAI-099` |
| Builder-A | `LAI-100` – `LAI-199` |
| Builder-B | `LAI-200` – `LAI-299` |

Take the lowest unused number **in your own range**, checked across all branches.
Ids issued before this decision (`LAI-001`–`LAI-026`) keep their numbers
regardless of who created them, and **nothing is renumbered** — ids are
referenced by `depends-on`, `discovered-from` and commit messages, and cleaning
up after a renumber is what LAI-015 cost.

**Rejected: PM as sole issuer.** Tidier, keeps ids chronological, and PM sees
every task as it is created. It also breaks the thing that makes
`discovered-from` work: a builder who finds something mid-task must file it
*immediately and without coordinating*, or they will carry it in their head and
file it later, or not at all. Routing every discovery through PM puts a
synchronous round-trip inside the one workflow specifically designed not to have
one — and PM is already the review bottleneck. Trading a rare id collision for a
guaranteed queue is a bad trade.

**Consequences.** Ids no longer sort chronologically across sessions —
`LAI-100` may predate `LAI-030`. Creation order lives in git and in the task's
own `started`/`created` fields, which is where it belongs; the id becomes a name
rather than a sequence, which it always really was. Ranges can in principle
exhaust: 99 ids per session against a project that has issued 26 in a day is not
an urgent risk, and the answer when it comes is another range, not a renumber.
A fourth session needs a range assigned before it starts — `LAI-300`+ is
reserved.

**Revisit when:** a session exhausts its range, or the session count outgrows
static allocation.

---

## D-018 — `LAIKA_SECRET` is required, and Laika-specific env vars carry the prefix
**Date:** 2026-08-24 · **Status:** accepted · **Supersedes** the `SERVER_SECRET` row and default in SPEC §11.7

**In one line:** a secret an operator never sees is a secret they never back up —
and a generic name like `SERVER_SECRET` is one collision away from meaning
something else.

**Context.** SPEC §11.7 said `SERVER_SECRET` defaults to "auto-generated to
`$DATA_DIR/secret` on first boot". Two implementations then did the opposite,
independently and without seeing each other: `server/src/env.ts` (LAI-005) throws
unless it is set, and `docker/entrypoint.sh` (LAI-008, a different builder) exits
unless it is set. Both also imposed a 32-character minimum the spec never
mentioned.

Two builders diverging from a document in the same direction is evidence about
the document, not about the builders.

Separately, the env surface had drifted both ways: `LAIKA_DB_PATH` and
`LAIKA_PUBLIC_DIR` were read by the server and absent from §11.7, while
`DISABLE_INVITE_ONLY` was documented and read by nothing. And the naming was
half-prefixed — three `LAIKA_` variables against four bare ones.

**Decision, three parts.**

1. **`LAIKA_SECRET` is required. No default, no auto-generation.** Minimum 32
   characters, enforced as a startup failure with the value redacted from the
   error. Stated in §11.7 and §12 rather than living in two implementations that
   happen to agree.
2. **Laika-specific variables carry the `LAIKA_` prefix**; `PORT`, `HOST` and
   `NODE_ENV` do not. So `SERVER_SECRET` → `LAIKA_SECRET`, `DATA_DIR` →
   `LAIKA_DATA_DIR`, `PUBLIC_URL` → `LAIKA_PUBLIC_URL`, `DISABLE_INVITE_ONLY` →
   `LAIKA_DISABLE_INVITE_ONLY`.
3. **§11.7 is the deployment contract**: everything the server reads is in it, and
   everything in it is read.

**Why required beats auto-generated.** Auto-generation makes `docker compose up`
work with no configuration, which is exactly what D-002 ("setup is the product")
argues for — and it is still the wrong call here, because the failure is
asymmetric. A required secret fails once, immediately, with a message naming the
fix. An auto-generated secret succeeds until `$LAIKA_DATA_DIR` is lost or
restored to a new host, at which point every session is invalid and every
`*_enc` column is permanently undecryptable, **with no error saying that is what
happened**. The operator's own backup is the thing that betrays them. One loud
failure at install time is cheaper than a silent one at restore time.

`docker/env.example` and a compose `${LAIKA_SECRET:?…}` message keep the setup
cost to one line, so D-002 is not really in tension — it costs a copy, not a
decision.

**Why prefix.** `DATA_DIR` and `SERVER_SECRET` are generic enough to already mean
something else in a shared compose file, a systemd unit, or a CI runner. The
prefix is collision safety, not tidiness. Doing it before v1 costs a rename;
doing it after costs operators a breaking change, so the only cheap moment is
now.

**Consequences.** Three variables get renamed across `server/src/env.ts`,
`docker/entrypoint.sh`, `docker-compose.yml`, `env.example` and the docker README
— filed as LAI-032 and LAI-033. Until those land, the spec and the code disagree
in the *opposite* direction from before, which is worse than one-sided drift, so
both are p1. The `LAIKA_SECRET` bridge Builder-B shipped in the entrypoint stops
being a bridge and becomes the real name.

**Revisit when:** never for "required". The prefix rule is revisitable only as a
whole — a half-prefixed surface is worse than either consistent choice.
