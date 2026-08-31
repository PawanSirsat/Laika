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

---

## D-019 — `--tx3` is darkened from the prototype; semantic colours are not body text
**Date:** 2026-08-24 · **Status:** ~~accepted~~ **REVERTED — superseded by D-020**

**In one line:** the design uses `--tx3` only at 8.5–12px, so the 3:1 large-text
allowance never applies to it — and at 2.51 it fails the bar that does.

**Context.** LAI-018 measured every token pair and reported two failures rather
than adjusting them, as its criterion required. `--tx3` reaches 2.51–4.06 against
our backgrounds; AA needs 4.5:1 for normal text and 3:1 for large text.

My first instinct — recorded in LAI-034 and wrong — was to keep the token and
constrain it to "de-emphasised metadata at size", on the reasoning that it clears
3:1. Counting the prototype's actual usage killed that: **165 occurrences, every
one at 8.5–12px**, 63 of them `JetBrains Mono` timestamps and counts. WCAG's
large-text threshold is 18.66px bold or 24px regular. Nothing in the design comes
close, so "constrain to large text" is not a constraint — it is a ban on the
token's only role.

**Decision.**

1. **Darken `--tx3`**: light `#8d94a4` → `#61697a`, dark `#71717d` → `#83838f`.
   The minimal lightness shift that clears 4.5:1 on all three backgrounds, hue
   and saturation preserved.
2. **Semantic colours are fills, borders and icons, not body text.** For coloured
   status text use `--tx` on the semantic subtle fill, not the semantic colour on
   `--card`.
3. Both rules live in `docs/design/README.md` beside the token table and are
   enforced by `tokens.test.ts`.

**Consequences.** This deviates from the design, and the deviation is the point:
`docs/design/README.md` already states the mockups are a target rather than
scripture and lists artifacts not to reproduce. A token that fails AA at every
size it is used belongs in that category, next to `postgres 16 · connected`.

The real cost is **hierarchy compression**. Light `--tx2` is 5.18 on `--tub` and
the new `--tx3` is 4.55 — the three text tiers are now visually closer than the
prototype drew them, and the design's information hierarchy is slightly flatter
as a result. `--tx2` cannot move up without failing its own AA, so the ramp
cannot simply be re-spread. If that flattening reads badly on a real screen, the
answer is a designer revisiting the whole ramp, not nudging one token back.

**Timing is why this is cheap.** M7 already carries an accessibility pass. Doing
it now costs two hex values; doing it then costs a visual regression across every
screen built on the old ones, and every screenshot in the docs.

`--acc` at exactly 4.50 on `--card` is left alone but is worth remembering: it
passes with zero margin, so any future nudge to either token breaks it silently.

**Revisit when:** a designer reworks the text ramp as a whole.

---

## D-020 — PM does not change design tokens; D-019 reverted
**Date:** 2026-08-24 · **Status:** accepted · **Supersedes D-019**

**In one line:** the measurements were right and the decision was not mine to
make.

**Context.** D-019 darkened `--tx3` in both themes, rewrote the contrast rules in
`docs/design/README.md`, and filed LAI-035 to apply it. I wrote all of it,
approved all of it, and told the owner afterwards.

The reasoning still holds and is preserved below. What does not hold is the
authority: `docs/design/` is the owner's imported visual reference, described as
*"the permanent visual reference"* when it was brought in. A change to it is a
decision for its owner.

The inconsistency is the part worth recording. All session I have held builders
to exactly this line — LAI-023's AC3 needed an unbuilt SPA and was deferred
rather than faked; LAI-030's criterion needed a `docs/` edit and was filed rather
than crossed; LAI-200 needed root config and waited for a grant. Three times a
builder hit a boundary and filed instead of crossing. Then I crossed one, in the
area I am least qualified to judge, and self-approved it.

**Decision.**

1. **D-019 is reverted.** `docs/design/README.md` is restored to the prototype's
   `--tx3`: light `#8d94a4`, dark `#71717d`. The contrast-rules section is
   removed. LAI-035 is closed unapplied — nothing reached code.
2. **PM never changes a design token, a colour, or any value in
   `docs/design/`.** A measured failure becomes a task for the owner. PM may
   measure, report, and recommend; PM may not decide.
3. The measurements survive as **LAI-041**, for the owner.

**The findings, preserved because they cost real work to obtain.** `--tx3`
measures 2.51 / 2.51 / 3.04 (light) and 4.06 / 3.81 / 3.56 (dark) against
`--page` / `--tub` / `--card`. The prototype uses it **165 times, every one at
8.5–12px**. WCAG AA needs 4.5:1 for normal text; the 3:1 large-text allowance
starts at 18.66px bold or 24px regular, so it does not reach any of those 165
usages. Separately, semantic colours as text on `--card` are 3.63–4.52 in light
against 5.42–8.74 in dark, with `--acc` at exactly 4.50.

None of that is in dispute. Who decides what to do about it was.

**Consequences.** The design stays exactly as imported, which is the property the
owner asked for when importing it. If the contrast issue is real — and the
numbers say it is — it now reaches code through a decision the owner made, and
correspondingly it may not reach code at all. That is the trade, and it is the
right one: a PM who edits the design because the measurements are convincing is
a PM who will edit the spec next.

**Revisit when:** never. The measurement half of this work was useful and should
continue; the deciding half was not mine.

---

## D-021 — Three §6.3 API-contract decisions
**Date:** 2026-08-24 · **Status:** accepted

Three findings from three different tasks all landed on SPEC §6.3. Settled
together because they edit one section and deciding them separately would have
meant writing that section three times.

### 1. `payload_too_large` (413) and `method_not_allowed` (405) are their own codes

**Not folded into `bad_request`.** The envelope gives clients a `code` precisely
so they branch on meaning rather than status, and the three remedies are
different: a too-large body means send less, a wrong method means call
differently, a malformed body means fix the JSON. Collapsing them makes three
problems indistinguishable to the caller and pushes the mapping into each
handler's judgement — which is what a closed vocabulary exists to prevent.

413 is not a corner case: §13.1 puts `bodyLimit` on every route, so it is the
documented behaviour of every endpoint. 405 arrives once routes declare methods.

*From LAI-022, filed by Builder-A during LAI-002.*

### 2. Writes share the general rate budget — no separate write limit

LAI-006's task text called for "60/min writes" and §6.3 never had it; the
implementation followed the spec (D-011) and the gap surfaced at review.

**Not restoring it.** The case a write budget was invented for is an agent
looping on `update_status`, and per-token 120/min already bounds that *more*
tightly, because a token cannot exceed 120 requests of any kind. A second bucket
adds machinery for a case the first already covers.

The argument the other way is real and worth recording: writes hit SQLite's
single writer (D-001) and each one writes an `activity` row, so the write path is
the scarce resource and it is the one without its own limit. If write contention
ever shows up, this is the first thing to revisit.

*From LAI-029.*

### 3. Anonymous traffic shares one bucket, deliberately

Documented as a limitation rather than left to look like an oversight. The
obvious improvement — per-IP buckets — requires trusting `X-Forwarded-For` behind
a reverse proxy, and trusting it without knowing which hop set it lets any client
forge its own identity. That is worse than one shared bucket, and Laika is
explicitly deployed behind Caddy or nginx (§11.7).

The liveness probe and static assets are exempt from limiting entirely: a Docker
`HEALTHCHECK` receiving `429` marks the container unhealthy and restarts it,
turning a burst of anonymous traffic into an outage. Exempt paths emit no rate
headers, because advertising a budget where none applies misleads the caller.

*From LAI-104, the `docs/` half of LAI-030 that Builder-A could not edit.*

**Consequences.** The error vocabulary grows from eight codes to ten, so
`server/src/http/errors.ts` and its tests need updating — **LAI-042**. The other
two decisions describe behaviour that already exists; they close the gap between
what the code does and what the document claims, which is the gap that produced
all three of these tasks in the first place.

---

## D-022 — `activity` nullability follows the type vocabulary; `system` is a third actor kind
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** a null actor means "no person did this", enforced — not "somebody
forgot to set it".

**Context.** SPEC §4.8 marked only `task_id` nullable while the same section
defines event types that cannot have a project (`token.created`,
`token.revoked`, `unlisted.logged`, org-level `member.added`) or a human actor
(`webhook.commit`, `webhook.received`, and every §11.6 cron job). The table as
written made rows the table requires impossible to insert.

Builder-A hit this implementing LAI-003, deviated to nullable, and flagged it in
a source comment rather than quietly diverging — which is how it reached a
decision instead of becoming folklore.

**Decision.**

1. `project_id` is **nullable**; org-scoped events have no project.
2. `actor_kind` gains a third value: **`system`** — no human, meaning cron or an
   inbound webhook.
3. `actor_id` is **nullable if and only if `actor_kind = 'system'`**, enforced by
   a database check constraint in both directions.

**Rejected: a seeded system user.** Every event would then have a real actor and
no query would need null handling, which is genuinely tidier. But it puts a fake
row in `users` that appears in member lists, can in principle be invited,
assigned work or given a token, and has to be seeded correctly by LAI-009's
first-run transaction — a thing that must never be got wrong, forever, to avoid
a null check. It also overloads `users` with something that is not a user.

`actor_kind` already exists to classify who acted, and the UI already branches on
it to badge agent actions. Adding a third case uses the mechanism that is there
rather than inventing a second one.

**Why the constraint matters more than the nullability.** Plain `actor_id
NULL`-able would make a null ambiguous: system-authored, or a bug that failed to
set the actor? For the table that feeds the audit trail, that ambiguity is the
whole problem. Tying null to `actor_kind = 'system'` in both directions makes the
schema answer the question instead of the reader guessing.

**Consequences.** `ACTOR_KINDS` grows, the check constraint is new, and both need
a migration — **LAI-044**. Anything reading `activity` must handle three actor
kinds, and the UI needs a system presentation distinct from user and agent. The
existing schema already has `project_id` and `actor_id` nullable, so that half is
a documentation fix rather than a change.

**Revisit when:** a fourth actor kind appears. Two is a distinction, three is a
vocabulary, four suggests the wrong axis.

---

## D-023 — The heartbeat write path ships in M4, with the hooks that call it
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** a hook whose endpoint does not exist for a whole milestone
cannot be tested, and an untested hook ships broken.

**Context.** `ROADMAP.md` put the plugin's heartbeat hooks in M4 and
`POST /api/v1/heartbeats` in M5. SPEC §8 requires hooks to fail silent (`|| true`)
so a missing endpoint degrades to a no-op rather than breaking a coding session —
which is why nobody noticed. But it means M4's builder has no way to verify the
hook does anything at all, and M4's exit criterion ("a new repo goes from nothing
to an agent working the board in one command") quietly excludes the presence half
of what the plugin is for.

**Decision.** The heartbeat **write path** moves to M4: accept `{repo, branch}`,
token auth, `202`, store the row. M5 keeps everything derived — branch → task
resolution, retention pruning, the presence and capacity views, dashboard
rollups. M4's exit criterion now says a heartbeat from the agent is visible in
the database.

**Why the write path and not all of §9.** The endpoint is small and its only
dependency is tokens, which land in M3. Branch → task resolution needs project
prefixes and the derived views need the whole `tasks` model, so they belong with
the milestone that presents them. Splitting on write-versus-read puts the cheap,
verifiable half where the thing that calls it lives.

**Rejected: move the hooks to M5.** Equally consistent, and it makes M4 a plugin
that does not do the one thing the plugin exists for. It also defers the first
end-to-end proof that a token minted by the CLI can authenticate a real request —
which is most of M4's actual risk.

**Consequences.** M4 grows by one small endpoint and M5 shrinks correspondingly.
Nothing else moves. `heartbeats` already exists in the schema (§4.10, built in
LAI-003), so this is a route and a service, not a migration.

**The general lesson is the one worth keeping.** This is the fifth
self-contradiction found in the planning documents today, and the fourth found by
a builder rather than by me. The pattern is always the same: a section written
before the thing existed, describing a shape that later turns out to be
impossible, unbuildable, or out of order. See LAI-045 for the audit that follows
from it.

---

## D-024 — Two contradictions found by auditing the unimplemented spec sections
**Date:** 2026-08-24 · **Status:** accepted

**In one line:** five self-contradictions were found by builders today; this is
the first two found before a builder hit them.

**Context.** Every planning-document contradiction so far surfaced the same way:
a builder implemented a section, then read it, then filed a task. §4's table
count, §11.7's env surface, §6.3's error and rate-limit gaps, §4.8's nullability,
and the M4/M5 heartbeat ordering (D-023) — five, four of them found by builders.

The common cause is sections written in one pass before any code existed. So I
audited the sections that are *still* unimplemented — §7 MCP, §9 presence,
§10 webhooks, §12 LLM — looking specifically for the classes that had already
bitten: an operation referencing something the schema cannot provide, a name that
two sections spell differently, a thing scheduled before its prerequisite.

§9 and §12 came back clean. §12's provider values match §4.2 exactly. Two
findings in §7 and §10.

### 1. `log_unlisted_work` has no REST twin

§7 says every tool is "a thin wrapper over the same service layer the REST routes
use", and §13.3 tests that a tool and its REST twin write identical `activity`
rows. Nine tools have twins. `log_unlisted_work` does not: §6.4 has
`GET /unlisted`, `POST /unlisted/:id/promote` and `DELETE /unlisted/:id`, but no
route that *creates* an entry.

**Decision: keep it agent-only and say so.** Unlisted work is by definition
something an agent noticed outside any project — a human at the board files a
task instead. Inventing `POST /api/v1/unlisted` to preserve a symmetry nobody
designed would add a human write path with no use case behind it. §7.2 now names
the exemption and §13.3 scopes parity to the nine tools that have twins, so a
missing tenth pair reads as intended rather than as an oversight.

### 2. `accepted_proposal_ids` referenced ids nothing defined

`POST /meeting-reviews/:id/apply` takes `{ accepted_proposal_ids[] }`, and
§10.2's proposal JSON contract — `{kind, task?, title?, description?, changes?,
reason, quote}` — has **no id field**. §4.12 stores proposals as a
`proposals_json` blob with no per-proposal identity either. The endpoint referred
to something that did not exist anywhere.

**Decision: the server assigns ids at store time; the model never supplies one.**
Ids must survive the round trip from review screen back to server, so they cannot
come from a model with no reason to make them unique or stable. Array index was
the other candidate and is worse — it breaks the moment a proposal set is
re-generated, and it breaks silently, applying the wrong proposal.

**Consequences.** Both are documentation fixes; neither has code yet (M3 and M6).
Which is the point — the previous five each cost a builder a claim, a release, or
a rework. Auditing the *unimplemented* sections is cheap precisely because
nothing has been built on them.

**The habit worth keeping:** re-read a section against the rest of the document
before its milestone starts, looking for operations that reference things the
data model cannot provide. That is the shape all seven of these took.

---

## D-025 — `LAIKA_DISABLE_INVITE_ONLY` is dropped, not implemented
**Date:** 2026-08-24 · **Status:** accepted · **Removes** a row from SPEC §11.7

**In one line:** an environment variable that overrides a security setting is a
way to turn off invite-only without leaving a trace in the org's own record.

**Context.** §11.7 listed `DISABLE_INVITE_ONLY` from the first draft as an
"escape hatch", with the note that the org setting is authoritative. Nothing ever
read it — LAI-105's drift check found it documented and unimplemented, which is
what forced the question of whether it should exist at all.

**Decision.** Removed from §11.7. `orgs.invite_only` (§4.2, D-004) is the only
control, changed through `PATCH /api/v1/org` by an Owner, which writes an
`activity` row like every other org change.

**Why not implement it.** The two are not equivalent, and the difference is the
whole point:

- An org setting is **auditable** — who turned invite-only off, and when, is in
  the activity trail (§4.8). An environment variable is set by whoever can edit
  the compose file, leaves no record inside Laika, and survives a restart with
  nobody able to say when it changed.
- It creates a state where the **UI and the behaviour disagree**: the org settings
  screen reports invite-only as on, and signup is open anyway. A support
  conversation that starts "the settings page is lying to me" is one nobody wins.
- The escape hatch it was meant to provide — an Owner locked out of their own
  instance — is better served by a documented recovery procedure than by a
  permanent override that is live in every deployment.

**Consequences.** An Owner who genuinely locks themselves out has no env-level
override. That is a real cost and the right one: recovery for that case belongs in
M7's operational docs, where it can be a deliberate, logged procedure rather than
a variable anyone with deploy access can set quietly.

**Revisit when:** a real lockout happens and the documented recovery turns out to
be insufficient.

## D-026 — the `WEB_*` structures in `structure.test.ts` belong to Builder-B

**2026-08-24. Context**: LAI-058 added one entry to `WEB_NO_MIRROR_REQUIRED` in
`server/test/tooling/structure.test.ts`. The §1 ownership table puts all of
`server/` except `server/web/` in Builder-A's area, and LAI-058 did not name that
file, so on the letter of the rule it was a crossing.

**Decision**: the `WEB_*` maps and lists in `server/test/tooling/structure.test.ts`
are **Builder-B's** by standing exception. The rest of the file stays Builder-A's.

**Why**: the rule had already stopped being applied. LAI-049 and LAI-106 made the
identical change and PM accepted both. A rule enforced on the fourth occurrence
but not the first three is not a rule, it is a trap — and the alternative was a
builder blocked on a one-line addition to a map that only their own area
populates.

The deeper reason is that the file is misfiled by the table, not by the builder.
It is one file serving two areas: the web half describes `server/web/`, which is
Builder-B's by D-016. Ownership follows what a section *describes*, not which
directory the file happens to sit in — the same principle D-016 settled for
`server/web/` itself.

**Rejected**: splitting the file into `structure.web.test.ts` and
`structure.server.test.ts`. Cleaner on paper, but the shared walker and the
mirroring rule would have to be duplicated or extracted into a third module, and
a test that enforces layout is more useful when it reads as one description of
the whole repo.

**Consequence**: PM stops treating a `WEB_*` edit as a crossing. Any other change
to that file from Builder-B is still one.

## D-027 — task tags are real, project-scoped, and flat

**2026-08-25. Decided by the owner**, on the question LAI-073 raised: the design
put a tag chip on every task card while the spec, schema and API had no such
concept, and PM does not add a feature to the spec by writing it down.

**Decision: tags exist.** SPEC §4.16 defines them; §3.2, §4.5, §4.13 and §6.4
are updated to match.

**The shape, and why.** Read off how the design actually uses them, not invented:

- **Many-to-many, via a join table.** One prototype task carries `['agent',
  'core']`, so a single column was never going to work. Rejected a JSON array on
  `tasks`: renaming a tag would be an update across every row, "which tags exist"
  would be a full scan, and nothing would stop `ui` and `UI` diverging.
- **Project-scoped, unique per project.** `ui` on a server project and `ui` on
  the web project are different concerns. It also keeps the picker short enough
  to choose from, which is what makes tagging get used.
- **Lowercase slug, enforced.** `^[a-z0-9][a-z0-9-]{0,23}$`. Case-variant
  duplicates are the specific failure that makes tag filters worthless.
- **Created by being applied.** No separate create step — an unknown name on a
  task creates the tag. Tagging stays one field rather than a workflow.
- **No colour.** Every chip in the design renders in the neutral `--tub`/`--bd`
  pair. A colour column means a palette decision and a settings screen for
  something the design never asks for.
- **Flat — no hierarchy, groups, or required tags.** That is how tag systems
  become a taxonomy nobody maintains. `priority`, `sprint_id` and
  `discovered_from` already carry the structured groupings.

**Policy reuses existing §3.2 cells rather than adding a new axis**: applying a
tag is part of editing a task (member+), while renaming or deleting one affects
everyone who filters by it (lead+). Two new matrix rows, no new concept.

**Activity uses `task.updated` with `{ field: 'tags', from, to }`** — the shape
`sprint_id` already uses. Deliberately **not** a new §4.8 verb: that vocabulary
has needed extending six times already (LAI-110, LAI-113), and this change does
not warrant being the seventh.

**Consequence.** LAI-079 builds the schema and API; LAI-066's tag chip stops
being excluded. The fourth design-ahead-of-spec gap is closed — `repo` (LAI-108),
the org presence toggle and the Calendar screen were the others, and the Calendar
still has no decision behind it.

## D-028 — both builders work on the UI; `server/web/` splits by screen

**2026-08-25. Owner escalation**: seven of eight sidebar destinations are empty
placeholders after 508 commits. The board is the only working screen.

**Cause, and it is a management failure not a build one.** D-016 gave all of
`server/web/` to Builder-B, so exactly one session could ever work on the
interface — while Builder-A ran four milestones ahead building APIs with no
screens to consume them. A complete sprints API sits unused; so do the activity
feed and the event stream. PM kept both queues full instead of keeping the
*product* moving.

**Decision: Builder-A works on `server/web/` too**, split by screen so the two
never touch the same file.

| Area | Owner |
| --- | --- |
| `routes/screens/sprints/`, `timeline/`, `dashboard/` and their CSS | **Builder-A** |
| `AppShell`, `Sidebar`, `route-table.ts`, `theme/`, `components/`, board, auth screens | **Builder-B** |
| `server/src/**` | Builder-A, unchanged |

**Shared files stay Builder-B's.** `route-table.ts` and `Sidebar.tsx` are edited
by one session only; Builder-B registers every route up front (LAI-082) so
Builder-A only ever adds files inside its own screen folders. That keeps the
file-move lock meaningful without a merge queue.

**Also decided: a nav item with no screen is not shipped.** Tokens, Capacity and
Meeting review have no API behind them (M3, M5, M6) and are hidden until they do.
A sidebar offering eight destinations where seven are dead reads as broken
software; one offering four that work reads as early software. The second is what
this is.

**Reverts when the UI has caught up.** This is a rebalance, not a new steady
state — when every shipped screen exists, `server/web/` returns to Builder-B and
Builder-A returns to the API.

## D-029 — `api/sprints.ts` follows the sprints screen to Builder-A

**2026-08-25.** D-028 gave Builder-A the sprints screen but left `api/` with
Builder-B. `api/sprints.ts` today has `listSprints` and `countSprints`; the screen
needs create, update, activate and delete.

That left two bad options: sprint API calls living in **two homes** — half in
`api/sprints.ts`, half in the screen folder — or Builder-A waiting on Builder-B
for every endpoint, which re-serialises the two sessions D-028 exists to
parallelise.

**Decision: `api/sprints.ts` is Builder-A's** for the duration of D-028.
Builder-B consumes `countSprints` for the nav count and does not edit the file.
One owner per file, one home per resource.

The general rule this expresses: **when a split by screen leaves a shared module
that only one side actively develops, the module follows the developer, not the
directory.** Builder-A flagged it before hitting it rather than picking whichever
option was locally convenient, which is why it is a decision and not a merge
conflict.

Reverts with D-028.

## D-030 — a shared module has one owner and the consumer guards its own contract

**2026-08-25. Amends D-029.** Builder-B pointed out that D-029 created a silent
failure mode: `api/sprints.ts` became Builder-A's, but `api/use-shell-context.ts`
— the sidebar's — imports `countSprints` from it. Builder-A could change that
function and neither session would know until the nav badge quietly stopped
working.

Three options were on the table: leave it with Builder-B and re-serialise the two
sessions D-028 exists to parallelise; move it and let Builder-B copy what the
shell needs; or move the count into Builder-A's folder and have the shell reach
into it.

**Decision: ownership stands with Builder-A, and Builder-B writes a contract test
for `countSprints` in their own test area.**

Ownership follows the developer (D-029) — Builder-A is adding create, update,
activate and delete while Builder-B needs one read function. But **a consumer that
depends on someone else's module protects that dependency with a test it owns.**
If Builder-A changes the signature or the shape, Builder-B's test goes red in the
same `pnpm test` run. Nobody has to remember.

**The general rule: a cross-ownership dependency is allowed, an unguarded one is
not.** Copying to avoid the dependency creates two truths that drift; forbidding
it serialises the work. A test makes the coupling explicit and loud, which is the
only property that actually matters — the failure mode Builder-B identified is
bad because it is *silent*, not because it is coupled.

Same shape as LAI-054 and LAI-061: the defect is never the dependency, it is the
absence of anything that fails when it breaks.

## D-031 — Builder-B owns the whole UI; D-028's split is retired

**2026-08-25. Owner direction.** Builder-B is bringing the entire UI into line
with the design prototype and takes all of `server/web/`. Builder-A has stopped
and agrees, and asked that it be written down rather than settled by agreement
between the two of them — correctly: **the next session reads the decision log,
not a conversation it never saw.**

**Retires D-028** (split by screen), **D-029** (`api/sprints.ts` follows the
developer) and **D-030**'s specific application to it. `api/sprints.ts` returns
to Builder-B with the rest.

Builder-A returns to `server/**`. D-016 is back in force: `server/web/` is
Builder-B's, everything else under `server/` is Builder-A's.

**D-030's general rule survives its example**: a cross-ownership dependency is
allowed, an unguarded one is not. It applies wherever the situation recurs.

**What D-028 was for, and whether it worked.** It existed because one session
owned all the UI while the other ran four milestones ahead building APIs nothing
consumed. It worked: Sprints, Timeline and Dashboard all exist because of it, and
each was built by the person who wrote its API. It ends because the owner wants
one hand on the whole interface for the design pass, which needs consistency more
than it needs parallelism.

## D-032 — demo data is allowed, and must be incapable of reaching production

**2026-08-25.** To render the prototype's screens, Builder-B needs data no
endpoint returns. CLAUDE.md §5.1 says *"Never hardcode mockup data. A hardcoded
value is a defect even when it looks right."* That rule is why the board is
honest, and it is also why it looks thinner than the mockup.

**Decision: a `src/demo/` layer is allowed, under conditions that are structural
rather than advisory.**

1. **It must not reach a production build.** Not "should not" — the built bundle
   in `server/public/` must be greppable for demo strings and come back empty,
   asserted by a test that runs after `pnpm build`.
2. **One file per missing endpoint, each naming the endpoint that retires it.**
   Builder-B's proposal, and the part that makes this temporary rather than
   permanent — a demo file with no named successor is a fixture with a nicer name.
3. **Every demo-fed screen says so on the screen**, not in a comment.
4. **Nothing in `src/demo/` may be imported by a screen that has a real
   endpoint.** Demo data next to real data is how the two get confused.

**Why not simply refuse.** The owner cannot evaluate a design they cannot see,
and *"this screen is empty because the backend does not exist"* is invisible to
anyone looking at a screen. The gap table (`docs/design/GAPS.md`) helps, but a
document is not a substitute for looking at the thing.

**Why the conditions are not negotiable.** The failure this guards against is a
self-hoster installing Laika and seeing sprints that are not theirs. That is not
a cosmetic bug — it is the product lying about someone's work, and it would be
discovered by a stranger rather than by us. A notice on the screen is not enough
on its own, because notices survive exactly as long as someone remembers to keep
them.

**§5.1 is amended, not overturned**: hardcoded data remains a defect in shipped
code. `src/demo/` is a named exception that cannot ship.

## D-033 — a task may authorise a named cross-area edit, when a drift check demands atomicity

**2026-08-25.** Four changes have now needed two owners in one commit: §4.16
(LAI-079), §4.8 (LAI-098), `tasks.acceptance_md` (LAI-092/130), and the
`dependencies` rename still to come (LAI-099).

The drift checks are **right** to demand it — the alternative is a spec that lags
silently, which is what LAI-051 and LAI-061 exist to prevent. What is wrong is
the *mechanism*: a task file carrying exact text, a round trip, a branch that is
red between the halves, and verification only possible by one session applying
the other's edit locally and reverting it. Builder-A described that as
"a workaround rather than a workflow", which is right.

**Decision: a task may authorise one session to edit specific, named things
outside its area — but only where a drift check would otherwise force a red
master.**

- **Named, not broad.** Sections by number (`SPEC §4.5`), or a single exemption
  entry — never a file, never a directory. "And whatever else is needed" grants
  nothing, exactly as CLAUDE.md §1 already says.
- **Recorded in the task**, so the crossing is auditable in the same place the
  work is.
- **Only for atomicity.** If the halves *can* land separately with master green,
  they must — ownership is unchanged for everything else.

**The limit, and why it is narrow.** LAI-092 needed no exception at all:
`COLUMNS_NOT_IN_SPEC` already models "code ahead of spec" and self-expires, so
the halves landed a commit apart with master green throughout. **That is the
normal case and it must stay normal.** The exception is for the other shape —
where an exemption is one the reviewer wants *gone in that commit*, so leaving it
is not an option.

**What this does not change.** `docs/` is still PM's and application code is still
the builders'. This is a keyhole, opened by a named task, for a problem the
checks create on purpose.

## D-034 — D-033's condition was wrong: named and auditable, not "only when forced"

**2026-08-26. Amends D-033.** I wrote that a cross-area edit is permitted *only*
where the halves cannot land separately with master green — "if they can, they
must".

LAI-134 was the first case to test it. Builder-A took the crossing and said
plainly in the task that the halves **could** have landed a commit apart, since
the exemption held either way, and that one commit was simply more convenient.
By the letter of D-033 that was not allowed.

**On reading it back, my condition was guarding the wrong thing.** The risk a
cross-area edit creates is that someone changes another session's files
**unseen**. It is not that they do it *unnecessarily*. A named, task-recorded,
reviewed crossing is equally safe whether or not a drift check forced it — and
splitting a small related change across two commits to satisfy a rule adds a
round trip and a window where the two halves disagree, for no gain.

**Decision: the condition is "named and auditable", not "only when forced".**

- The task **names exactly what will be touched** — a section by number, a single
  entry, a specific mapping. Never a file, never a directory.
- The reviewer **sees the crossing** and says so in the review.
- Ownership is otherwise unchanged: `docs/` is PM's, application code is the
  builders'.

**What is still forbidden** is what LAI-134's own history shows: I tried to land
both halves myself and stopped once it became clear the fix needed *designing*
how self-scoped actions are verified. **A named edit is not a design change to
someone else's file.** That boundary is the one that matters, and it is unchanged.

Builder-A found this by being transparent about doing something the rule did not
strictly permit, rather than either not doing it or not mentioning it. A rule
tested honestly is worth more than a rule obeyed silently.

---

## D-035 — The three sessions are CHIEF, CORE and SHELL

**Date:** 2026-08-31 · **Decided by:** the owner · **Status:** accepted

`PM`, `Builder-A` and `Builder-B` were bootstrap labels. They described a
hierarchy that does not exist — there is no first and second builder, and "PM"
suggests a role that reports upward rather than one that holds the plan. Worse,
`Builder-A` and `Builder-B` are not memorable: which one owns the UI has to be
looked up every time, and it has been looked up wrong.

**Decision: rename them for what they own.**

| Was | Is | Command | Branch | Directory |
| --- | --- | --- | --- | --- |
| PM | **CHIEF** | `/chief` | `master` | `Laika/` |
| Builder-A | **CORE** | `/core` | `core` | `Laika-core/` |
| Builder-B | **SHELL** | `/shell` | `shell` | `Laika-shell/` |

CORE is the engine — API, database, policy, MCP. SHELL is everything wrapped
around it — the SPA, the plugin, the CLI, the container. The names carry the
D-016 boundary in themselves: nobody has to remember which letter got the
frontend.

Each name is also a command that boots the identity, takes the latest `master`,
reports the board, and starts that session's next job. `/<name> status` reports
without acting. `/claim`, `/review` and `/standup` remain and are unchanged in
behaviour.

**Consequences**

- Branches `builder-a` and `builder-b` are renamed `core` and `shell`; the
  worktree directories follow. Any session that was open under an old path must
  be restarted from the new one.
- **Nothing already written is rewritten.** `.tasks/done/`, `logs/`, and every
  DECISIONS entry above this one keep the names they were authored with, by the
  same append-only rule that governs decisions. `.sessions/README.md` and
  `CLAUDE.md` carry the mapping so an old name is always resolvable.
- Files that name a session inside `server/`, `server/web/`, `plugin/`, `cli/`
  and `docker/` are the builders’ to update, not CHIEF’s. Filed as LAI-400 and
  LAI-401 rather than crossed into — the rename is not a licence to edit
  someone else's area.
- Session ranges are unchanged: CHIEF `LAI-001`–`LAI-099`, CORE
  `LAI-100`–`LAI-199`, SHELL `LAI-200`–`LAI-299`. Renumbering ids remains
  forbidden (D-017).

**Revisit if** a fourth session is added, at which point the naming needs to
extend rather than be re-chosen.

---

## D-036 — CHIEF's id range is exhausted; ranges continue in a second block

**Date:** 2026-08-31 · **Decided by:** CHIEF · **Status:** accepted

Filing the two follow-up tasks for D-035 turned up something the board has been
one task away from for a while: **`LAI-001`–`LAI-099` is completely full.** All
99 ids are issued. CORE has used 36 of its 100, SHELL 25.

D-017 gave each session a block precisely so that "next unused number" could
never be a race. That property depends on there always *being* a free number in
your own block, and for CHIEF there is not. The failure mode if this is not
fixed is exactly the one D-017 was written to prevent: a session reaches outside
its block, two sessions pick the same id, and `depends-on` starts pointing at
the wrong work.

**Decision: each session gets a second block, taken when its first fills.**

`LAI-300`–`LAI-399` is **not** available for this: D-017 reserved it for a
fourth session, and that reservation stands. Second blocks start above it.

| Session | First block | Second block |
| --- | --- | --- |
| CHIEF | `LAI-001`–`LAI-099` (full) | **`LAI-400`–`LAI-499`** |
| CORE | `LAI-100`–`LAI-199` | `LAI-500`–`LAI-599` |
| SHELL | `LAI-200`–`LAI-299` | `LAI-600`–`LAI-699` |
| *(a fourth session)* | `LAI-300`–`LAI-399` — reserved, D-017 | — |

CHIEF's next id is **`LAI-400`**. A session moves to its second block only when
its first has no free number left, and the rule for picking is unchanged: lowest
unused number in your own block, checked across every branch.

This is the revisit D-017 asked for in its own closing line — *"Revisit when:
a session exhausts its range"* — and it is answered the way D-017 said it would
be: another range, not a renumber.

**Renumbering remains forbidden.** Nothing above `LAI-099` is reassigned and no
existing id moves — ids are referenced by `depends-on`, `discovered-from` and
commit messages, which is what LAI-015 had to clean up.

**Revisit if** a second block fills, which on current velocity is far enough out
that inventing a scheme for it now would be guessing.

---

## D-037 — A guard may assert a property, never a contingent fact

**Date:** 2026-08-31 · **Decided by:** CHIEF, from CORE's finding on LAI-414
**Status:** accepted

This board has been bitten six times by a **justification that expires
silently** — an exemption whose reason stopped holding while the entry sat there
looking deliberate (LAI-052, LAI-080, LAI-043, LAI-213, LAI-066, LAI-211). The
answer each time was the same: make the exemption self-expire, so the guard goes
red when the gap it covers closes.

LAI-414 turned up the **mirror image**, and it is worse.

While fixing the file-list hole, CORE wrote a sanity assertion proving the
extractor was not inventing types:

```js
expect(emitted).not.toContain('token.created')
```

True on the day it was written. **LAI-402 makes it false by doing exactly what it
is supposed to do** — minting a token emits `token.created`. The next builder
would have met a red test on correct code, found no defect to fix, and
reasonably deleted the assertion. A real guard removed, by a competent person, to
unblock work that was right.

**Both failures are the same mistake: asserting a contingent fact as though it
were a property.**

- *"`token.created` is not emitted"* — a fact about today's codebase.
- *"everything found is a member of `ACTIVITY_TYPES`"* — a property of the
  extractor, true whatever anyone builds next.

**Decision: a guard asserts properties. When a fact is genuinely what needs
asserting, it must carry the condition that retires it.**

Before writing an assertion, ask **what makes this false** — and if the honest
answer is *"someone doing their job correctly"*, it is the wrong assertion. The
test should be rewritten to the property underneath it, not annotated with a
comment asking the future not to delete it.

**Consequences**

- The self-expiring exemption rule is unchanged and now has a sibling. Silent
  expiry costs coverage nobody notices; loud expiry costs a guard someone
  deletes. Neither is a smaller failure than the other.
- A red test met while building something new is **not** automatically a defect
  in the new work. Read the assertion and ask which of the two it is before
  changing either side. That is now the first question, not the last.
- This is cheapest to catch at review, because the reviewer is the one who knows
  what is coming next. It was caught here only because the same session held
  both LAI-414 and LAI-402.

**Revisit if** a guard is found that must assert a fact and cannot be rewritten
to a property — at which point the condition-that-retires-it needs a documented
shape rather than being written case by case.

---

## D-038 — A row→action mapping belongs to the document it mirrors

**Date:** 2026-08-31 · **Decided by:** CHIEF · **Status:** accepted

`server/test/tooling/policy-spec-drift.test.ts` holds `ORG_ROWS` and
`PROJECT_ROWS` — maps from a **SPEC §3 table row's label** to the `can()` actions
that implement it. They are what makes §3 ↔ `can()` a closed loop.

LAI-408 exposed that they have no owner. Growing §3.1 by one row needs three
things in one commit: the row (`docs/`, CHIEF), the action (`server/src/`, a
builder), and the **mapping** (`server/test/`, unowned in practice). CORE could
not add the mapping before the row existed — the staleness check fires on a
mapping whose row is absent — and CHIEF could not add the row before the mapping
existed without turning `master` red. Neither half is committable alone.

**Decision: a row→action mapping follows the document it mirrors. `ORG_ROWS` and
`PROJECT_ROWS` are CHIEF's**, in a file that is otherwise CORE's.

This is **D-026's principle, not a new one**: ownership inside a shared test file
follows what a section *describes*, not the directory the file sits in. D-026
settled it for the `WEB_*` maps in `structure.test.ts` — SHELL's, in CORE's file
— for exactly this reason. A mapping of §3's rows describes §3.

It is also the crossing D-034 already contemplates: *"a SPEC section by number, a
single exemption entry, **a specific mapping**; never a file, never a
directory."*

**What this does not grant.** CHIEF may add, remove or correct **entries in those
two maps** and nothing else in that file — not the parser, not the assertions,
not the exemption lists, not the counts. The `toHaveLength` assertion that broke
in the same commit is about how the **parser** behaves and stayed CORE's, and was
fixed by CORE. If a mapping change turns out to need reshaping how the test
works, it stops being a mapping change and goes back to them (CLAUDE.md §1: *"a
named edit is not a design change to someone else's file"*).

**Consequences**

- Growing §3 is now a **single atomic commit** by CHIEF over a builder's merge:
  the row, the mapping, and the builder's action arriving together. No red
  window, and no builder holding a red branch waiting.
- The same shape applies to any future mirror-of-a-CHIEF-document map. It does
  **not** generalise to test data that merely mentions a spec section.
- **PM still writes no application code.** A mapping entry is a restatement of a
  document CHIEF owns, in the form a test can read — the same category as the
  spec table itself. If that reading ever has to stretch, it has stopped being
  true and this decision should be superseded rather than widened.

**Revisit if** a third session needs entries in the same maps, or if a mapping
change ever requires touching the parser to land.

---

## D-039 — The four questions that were blocking work, answered

**Date:** 2026-09-01 · **Decided by:** CHIEF, on the owner's instruction to
finish what is pending · **Status:** accepted

Four things had been sitting unanswered and were blocking or distorting work.
The owner asked for everything outstanding to be done rather than escalated, so
each is decided here with its reasoning, and each can be reversed by them in one
line.

### 1. There is no Calendar screen (closes §14 q10, closes LAI-217)

§14 q10 asks whether the prototype's `WORK → Calendar` is *"a date-grid over
sprints, nearly free like the Timeline"*, or something that *"implies per-task
dates and reopens D-014"*.

**It is neither, because there is nothing to put on it.** D-014 settled that
**tasks never get dates**. The only dates in the product are a sprint's
`starts_on` and `ends_on` — and a date-grid whose only content is four sprint
bars is the Timeline drawn differently. It would be a second view of one dataset,
carrying a nav entry, a route and a screen's worth of code to say what §11.4.3
already says.

Building it the other way — a calendar of task due-dates — **reopens D-014**,
which is the one decision keeping the Timeline free rather than costing a
scheduling engine.

**So: no Calendar.** `LAI-217` is closed as *not building*, not as done. If the
owner wants per-task scheduling, that is a reversal of D-014 and this decision
follows it rather than leading.

### 2. `@mentions` and Watch ride the existing SSE stream (unblocks LAI-094)

Three options were open: in-app only, in-app over the existing stream, or email.

**In-app over the existing stream.** `/api/v1/events` already exists, already
fans out per project, already carries `Last-Event-ID` replay, and the board
already consumes it. A notification is an `activity` row a person is interested
in — which is a thing the stream is already delivering. The other two both add a
delivery mechanism: email needs SMTP configured, a queue, retries, and a bounce
story before a single mention arrives, and in-app-only-without-the-stream means
polling something the stream already pushes.

**Email is not refused, it is sequenced.** When SMTP exists for invites it can
carry mentions too, and the read model will already be built.

### 3. `@modelcontextprotocol/sdk` stays, and is revisited at M7

79 packages, 17 direct, including `express`, `cors`, `express-rate-limit` and
`cross-spawn` (LAI-406). Measured: **none of them load** — they arrive through
the SDK's express adapter, OAuth router and stdio client, none of which Laika
imports. It is disk and SBOM surface, not runtime surface.

**Keep it.** The alternative is writing the Streamable HTTP transport ourselves,
which is a wire protocol we would then own and have to track — and M3 works. But
it is a real surface on a self-hosted product, so it goes on the **M7 release
polish** list explicitly rather than being forgotten now that the deps are quiet.

### 4. M1's exit criterion is met

*"`docker compose up` → open the browser → create the Owner account → see an
empty authenticated shell."*

Done, repeatedly, most recently on 2026-09-01: the volume was destroyed, the
image rebuilt from `master`, `POST /api/v1/setup` created the Owner, and a
browser signed in and rendered the authenticated shell. Nothing about it needs a
second person to perform it — it needed **someone** to perform it, and it has
been.

**Revisit if** the owner reverses D-014 (which reopens 1), SMTP lands before
LAI-094 is built (which changes 2's sequencing), or an SBOM review rejects the
SDK's surface (which forces 3).
