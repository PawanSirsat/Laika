# Proposal — Fleet dispatch: any machine with capacity can take a card

| | |
| --- | --- |
| Task | LAI-863 (parent, **on hold** until the owner approves) |
| Status | Proposal — research complete, nothing built |
| Author | CHIEF (polly), 2026-10-21 |
| Decision needed | D-0XX "Fleet dispatch" — Belka writes it on approval (D-097 §4) |

## 1. The problem

Laika already knows *who* is working (presence, capacity, tokens). It does not
know *where*. Today the owner has Belka and Strelka, could add cloud runners,
and teammates have laptops that sit idle — but handing work to any of them is a
human writing an `@strelka` comment and a human opening a terminal (D-097).
Nothing tells Laika which machines are up, what they can run, or lets a free
machine pick up a card by itself.

We want:

1. **See the fleet** — which machines are online, idle, busy, and what they can
   run — from a command and in the UI.
2. **Manual dispatch** — a human says "send LAI-NNN to Strelka" and only then
   does it go there.
3. **Autopilot dispatch** — opt-in; Laika picks an eligible free machine and
   the work starts there with no human in the loop until review.
4. **Fast wake-up** — a machine learns about its work in seconds, not when
   someone remembers to tell it.

## 2. What exists today (measured, 2026-10-21)

Evidence is in the research reports kept with LAI-863; file:line references
there. The short version:

| Area | Today | Gap |
| --- | --- | --- |
| Identity | An actor is always a user; agents are that user's token (D-010). | No machine identity. Two laptops on one token are indistinguishable. |
| Presence | `heartbeats` rows carry `{repo, branch}` only, frozen by D-005; presence is per person (SPEC §9.3). | No host, capability, capacity or drain state. |
| Assignment | `tasks.assignee_id` → `users` only. | No execution target, lease or release. Overloading `assignee_id` would erase "who is responsible" vs "where it runs". |
| Tags | Grammar `^[a-z0-9][a-z0-9-]{0,23}$`. | **D-097's `host:strelka` tag cannot be created** — `:` is rejected. |
| Claim | `list_ready_tasks` + `start_working` (two calls). | No atomic claim-next; a race between two machines. |
| Push | SSE `/api/v1/events` (ActivityFeed polls SQLite every 250 ms). WebSockets are a v1 non-goal (SPEC §1.1). | No machine-targeted subscription; plugin has outbound hooks only. |
| Tokens | `full` / `read_only`, optional project pin. | Too coarse for a least-privilege daemon (SPEC §14 already lists granular scopes as open). |
| CLI | `laika init/whoami/connect/activity/time`. | No `laika machines`, no long-running runner. |
| UI | Sidebar HOME / SPACES / ORGANISATION; Insights has Capacity + Usage. | No fleet view, no "run on" control. |

**Omnigent already solves half of this.** Each Omnigent host daemon dials out
over WebSocket to its server (NAT-safe), probes and reports
`configured_harnesses` readiness, and the server can launch a session on a
chosen host: `GET /v1/hosts` lists online hosts with readiness;
`POST /v1/sessions {host_type:"external", host_id, workspace}` starts a runner
there; `host_type:"managed"` provisions a cloud sandbox (Modal, Daytona, E2B,
K8s…). Caveat: Omnigent is alpha and these are internal REST contracts.

**Claude Code alone** offers `claude -p` (headless), `--bg` + `claude agents
--json` (local background), `--cloud` (Anthropic cloud) and `remote-control`
(drive a *local* session remotely). None enumerates several machines.

**Prior art** (GitHub Actions runners, GitLab, Buildkite, Temporal, SQS,
BullMQ, Nomad/K8s) converges on one shape: outbound pull, label/capability
matching, renewable leases with fencing, at-least-once with idempotent side
effects. No hosted agent product (Codex Cloud, Cursor, Devin, Copilot agent)
publishes a way to choose among *your own* machines — that is the gap Laika
fills.

## 3. Proposal

### 3.1 Principles

1. **The board is the source of truth; git and push are not.** A card's
   dispatch state lives in Laika's SQLite. Notifications are hints.
2. **Pull, never push.** Machines dial out; nothing ever connects *into* a
   laptop. Works through NAT, home routers and corporate firewalls.
3. **Responsibility ≠ execution.** `assignee_id` stays the person. A new
   *dispatch* records the machine.
4. **Manual is the default; autopilot is opt-in per project *and* per
   machine.** A teammate's laptop is `manual_only` until its owner flips it.
5. **Every attempt may run twice.** Leases + fencing tokens make that safe for
   Laika's own state; branches named per attempt and PR-only output make it
   safe for git.
6. **The PR is the human gate.** Autopilot ends at `finish_task` → Review,
   exactly as today. Only Pawan moves a card to Done.

### 3.2 Concepts

- **Machine** — an enrolled execution resource: a laptop, a VM, a cloud
  sandbox pool. Has an owner (a user), a name (`belka`, `strelka`,
  `cloud-modal`, `ravi-mbp`), a key, capabilities and a policy.
- **Capabilities** (machine-reported, advisory): OS/arch, CPU/RAM, max
  concurrent slots, which agent CLIs are installed *and authenticated*
  (mirroring Omnigent's `configured_harnesses`), which repos are checked out,
  on AC power or battery, free labels (`heavy-builds`, `browser-tests`).
- **Policy** (owner-set, server-side, authoritative): allowed projects/repos,
  `manual_only`, `accepts_autopilot`, max concurrency, quiet hours, cost class
  (`free` laptop vs `metered` cloud), risk tier (read-only / code-change).
  A machine *claiming* a repo never grants access to it.
- **Dispatch** — "this card should run somewhere": mode (`manual` |
  `autopilot`), pinned machine (manual), requirements (agent CLI, labels,
  min RAM), priority, budget.
- **Attempt** — one execution of a dispatch on one machine: `machine_id`,
  `fence`, `lease_until`, branch, agent session id, status, result.

### 3.3 Lifecycle

```
dispatch created ──► queued
   queued ──(machine claims, atomic, fence=n)──► running(lease_until)
   running ──heartbeat──► lease extended
   running ──finish_task(fence=n)──► review          (card → Review, PR open)
   running ──lease expires──► orphaned ──► queued (fence=n+1) or held for human
   running ──release / cancel──► queued | cancelled
```

A woken laptop holding fence *n* after *n+1* exists is refused on every write
and must stop; its worktree is offered for manual recovery, never auto-pushed.

Starting numbers (policy, tunable): presence heartbeat 30 s; machine `suspect`
at 60 s, `offline` at 90 s; work lease 5 min renewed every 60 s; laptop grace
15 min before an autopilot re-queue (sleeping lids are normal, not failure).

### 3.4 Wake-up: how a machine learns about work

Layered, cheapest first; only the first is required:

1. **Long-poll** `GET /api/v1/runner/next?wait=50` — the runner holds a request
   open; Laika answers the instant a dispatch for it (or, in autopilot, any it
   is eligible for) is queued. This is what GitHub/GitLab runners do and needs
   no new infrastructure.
2. **SSE** (already shipped) — the UI and `laika machines --watch` see
   dispatch/claim/lease events live.
3. **Optional push hint** — self-hosted ntfy (or Web Push) to tell a *human*
   "LAI-NNN is waiting for Strelka" or nudge a reconnect. Carries no secret,
   grants no claim.

A fully asleep laptop cannot be woken by any of these. That is fine: manual
dispatch stays `queued` with a visible "waiting for Strelka (offline 2 h)"
badge; autopilot simply prefers an online machine.

### 3.5 Two ways to run the executor

| Option | What runs on each machine | Pros | Cons |
| --- | --- | --- | --- |
| **A. Laika runner** (`laika runner up`) | A small CLI daemon: enrol, heartbeat, long-poll, start `claude -p` / `codex exec` in a fresh worktree, renew lease, report. | Self-contained; works for teammates with no Omnigent; matches Laika's self-hosted story. | New long-running process to build and support. |
| **B. Omnigent bridge** | Nothing new; Laika calls the owner's Omnigent server (`GET /v1/hosts`, `POST /v1/sessions` on a host). | Reuses host registration, readiness probes, cloud sandboxes, and the UI takeover terminal for free. | Ties Laika to an alpha API; needs an Omnigent service credential; teammates must run Omnigent hosts. |

**Recommendation: A as the contract, B as the first adapter.** Laika owns the
data model, leases and policy (§3.2–3.3) regardless. The executor sits behind
one adapter interface — `probe / start / stream / cancel / checkpoint` — with
three implementations, built in this order:

1. `omnigent` — Belka/Strelka already run it; quickest end-to-end demo.
2. `local-cli` — `claude -p` / `codex exec` directly, for teammates without
   Omnigent.
3. `cloud` — via Omnigent managed hosts or `claude --cloud`, metered.

### 3.6 Manual vs autopilot

**Manual** (default everywhere): a human picks "Run on → Strelka" on the card,
or `laika dispatch LAI-NNN --on strelka`, or the MCP tool
`dispatch_task {task, machine}`. Only that machine may claim it. If it is
offline the card waits and says so.

**Autopilot** (opt-in per project, per machine): Laika places queued
dispatches itself.

- *Hard filters* — online and accepting; policy allows the repo; required
  agent CLI installed and authenticated; free slot; budget not exceeded;
  manual pin respected; not in quiet hours; not on battery if policy says so.
- *Score* (illustrative weights, recorded with every decision so the UI can
  show *why*): +200 same machine as previous attempt (warm worktree/session),
  +100 repo already checked out, +50 matching label (`heavy-builds` →
  Strelka), −40 per running task, −80 metered cloud, −100 recent lease loss.
- *Guard rails* — per-machine and per-project concurrency caps, daily
  token/money budget (reuses usage telemetry, SPEC §4.23/§4.38), max attempts
  per card, circuit breaker after repeated failures, no hard preemption (ask
  the running agent to checkpoint and yield instead).

Autopilot never crosses the PR boundary: it ends in Review. A "propose only"
sub-mode — Laika suggests a machine, a human taps Approve — is the safe first
step before full autopilot.

### 3.7 Who is online — command and UI

- `laika machines` — table: name, owner, status (online / busy / suspect /
  offline / draining), slots used/total, agents ready (claude ✓ codex ✓),
  running cards, last seen. `--watch` follows SSE.
- MCP `list_machines` and plugin `/laika:machines` — the same, for agents and
  for CHIEF/polly planning a fan-out.
- UI **Fleet** screen under ORGANISATION (or a third tab in Insights beside
  Capacity/Usage): machine cards with live status, the queue, recent
  placements with their score explanation, enrol/revoke/drain buttons.
- Card detail: a **Run on** control beside (not replacing) the assignee
  control; an attempt timeline (claimed by Strelka · lease ok · PR #123).

### 3.8 Security — enrolling a teammate's laptop

1. An owner/admin creates a single-use **join code** (scoped to org + allowed
   projects, expires in 1 h).
2. Teammate runs `laika runner join <url> <code>`; the runner generates a
   keypair, stores the private key in the OS keychain, registers.
3. Laika issues a **machine credential** that can only: heartbeat, update
   capabilities, long-poll, claim. Each claim mints an **attempt token** good
   for that one attempt (comment, renew, finish). The agent subprocess gets
   the attempt token, never the machine credential.
4. Agent provider logins (Claude, Codex) **stay on the machine**; Laika records
   only "authenticated: yes/no".
5. Revoke = immediate; all live leases are fenced out.
6. Teammate machines default `manual_only: true`; per-attempt worktree; no
   home-dir or Docker socket exposure; every enrol/claim/release/revoke is an
   activity row.

This needs a new token kind (machine) and the granular scopes SPEC §14 already
lists as open — a decision, not a workaround.

## 4. Data model sketch (for CORE, decided in SPEC by CHIEF)

| Table | Key fields |
| --- | --- |
| `machines` | id, org_id, owner_user_id, name, public_key, status, last_seen_at, accepting, revoked_at |
| `machine_capabilities` | machine_id, os, arch, cpu, ram_mb, slots, harnesses (json), repos (json), labels, power |
| `machine_policies` | machine_id, allowed_project_ids, manual_only, accepts_autopilot, max_concurrency, cost_class, quiet_hours |
| `dispatches` | id, task_id, mode, pinned_machine_id, requirements (json), priority, created_by, status |
| `dispatch_attempts` | id, dispatch_id, machine_id, attempt_no, fence, lease_until, branch, agent_session_ref, status, score_explain (json) |

New activity verbs (`machine.enrolled`, `machine.revoked`, `dispatch.created`,
`dispatch.claimed`, `dispatch.released`, `dispatch.lease_expired`) — **each is
a three-owner change** (§4.4: CHIEF SPEC row, CORE enum/CHECK, SHELL client
mirror + dashboard wording). Batch them into one round.

D-097 fix-up: `host:` tags cannot exist under today's grammar. Either relax
the grammar for a `host-` prefix (`host-strelka`) or, better, let the dispatch
`pinned_machine_id` replace the tag entirely once phase 1 lands.

## 5. Phased plan → child tasks

Each phase is shippable and useful on its own. Ownership per CLAUDE.md §1.

| Phase | Outcome | Child tasks (area) |
| --- | --- | --- |
| **0. Decide** | SPEC + decision approved | CHIEF: D-0XX Fleet dispatch; SPEC §3.1 rows, §4 tables, §7.1 tools, §4.8 verbs; fix D-097 tag wording (docs) |
| **1. See the fleet** | `laika machines` and a Fleet screen show Belka/Strelka live | CORE: `machines` + capabilities + enrol/heartbeat/list REST + `list_machines` MCP + `can()` rows · SHELL: `laika runner join/up` (presence only), `laika machines`, Fleet screen, `/laika:machines` |
| **2. Manual dispatch** | "Run on Strelka" starts the work there | CORE: dispatches/attempts, atomic claim, lease+fence, `dispatch_task`/`claim_next`/`release` · SHELL: runner long-poll + Omnigent adapter + `local-cli` adapter; Run-on control; attempt timeline · three-owner: activity verbs |
| **3. Autopilot (propose)** | Laika suggests a machine; one tap to approve | CORE: placement filter+score with explanation, project/machine opt-in flags · SHELL: approve UI |
| **4. Autopilot (full)** | Queued cards place themselves within budgets | CORE: guard rails, budgets, circuit breaker, orphan re-queue · SHELL: budget/settings UI |
| **5. Teammates & cloud** | Enrol a teammate laptop; metered cloud pool | CORE: join codes, machine/attempt tokens, revoke fencing · SHELL: cloud adapter, enrol flow · optional ntfy hint |

Phase 1 alone retires the "is Strelka on?" question; phase 2 retires the
hand-written `@strelka` comment.

## 6. Open questions for the owner

1. Approve **Laika-owned contract + Omnigent as first adapter** (§3.5)?
2. Fleet as its own ORGANISATION screen, or a third Insights tab?
3. Should autopilot start with **propose-only** (recommended) for a sprint?
4. Cloud: Omnigent managed sandboxes, `claude --cloud`, or both — and the
   monthly budget cap?
5. Teammates: who may create join codes — org admins only?
6. Does a machine belong to a user (recommended) or to the org?

## 7. Risks

- Omnigent's REST API is alpha — mitigated by the adapter boundary.
- A sleeping laptop holding a lease delays autopilot — mitigated by grace +
  re-queue with fencing; manual dispatch just waits visibly.
- Running repo code on teammates' laptops — mitigated by manual-only default,
  per-attempt worktrees, attempt-scoped tokens, PR-only output.
- Scope: this is the largest feature since MCP. The phases are cut so we can
  stop after any one of them with something useful.
