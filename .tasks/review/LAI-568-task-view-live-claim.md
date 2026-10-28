---
id: LAI-568
title: 'Serve the live claim on task reads: holder session, last heartbeat, connection, lease expiry, generation — so cards can say Working / Connection lost'
area: server
assignee: strelka
priority: p1
depends-on: [LAI-541]
discovered-from: LAI-543
status: review
started: 2026-10-28T11:15:20Z
finished: 2026-10-28T11:27:19Z
---

Filed by SHELL (Belka, dispatched by polly) from CHIEF's block, 2026-10-28.

## Why

LAI-543 has to draw **Working** (an agent session holds the task and is
checking in) and **Connection lost** (it stopped checking in; suspect past
`LAIKA_CLAIM_SUSPECT_SECONDS`) on cards and in the drawer — proposal §6, and
LAI-543's scope names *"from `last_heartbeat_at` vs the suspect threshold"*.

No read a browser session can make returns either fact today:

- `TaskView` / `TaskSummaryView` (`server/src/services/tasks.ts`) carry
  `selected_agent` and nothing about a claim.
- `TaskClaimView` and `AgentSessionView` (`server/src/services/claims.ts`) are
  answered only to the agent itself — `POST /tasks/:id/claim`, `POST
  /agent-sessions/*`, the reclaim — all agent-token only.
- Heartbeats write no activity, so the SSE stream cannot carry the transition
  to suspect either.

LAI-543 therefore draws only what is served: *Waiting for agent* (from
`selected_agent` + status) and the claim **history** from the task's activity
(`task.status_changed via: 'claim'`, `task.updated field: 'claim'`,
`task.claim_expired`, `task.claim_reclaimed`), including the expired-claim
notice. It does not stub the missing fields (CLAUDE.md §5.1).

## Scope

- On `TaskSummaryView` (and so `TaskView`), a `claim` field: the task's live
  claim (`active` or `paused`), else `null`. Suggested shape, CORE's call:
  ```
  claim: {
    generation: number;
    state: 'active' | 'paused';
    agent_id: string;
    session_id: string;
    lease_expires_at: number;
    last_heartbeat_at: number;      // the holding session's
    connection: 'live' | 'suspect'; // as AgentSessionView computes it
    device_label: string | null;    // the agent's, for "Claude Code · laptop-1"
  } | null
  ```
  One query per page, as `selectedAgents` is (LAI-091).
- Either a `suspect_after_ms` the client can compare against with its own
  clock, or a guarantee that the board re-reads tasks often enough for
  `connection` to move from `live` to `suspect` without an event. Say which in
  §6.4; heartbeats write no activity, so there is no frame to re-read on.
- SPEC §4/§6.4 rows for the field.

## Out of scope

- The client half: the drift check (`view-type-drift.test.ts`) will go red
  on `TaskView.claim` / `TaskSummaryView.claim` until SHELL mirrors it — §4.4,
  two owners. SHELL then turns `cardExecutionState`
  (`server/web/src/components/agent/execution-derive.ts`) into Working /
  Connection lost and fills the drawer's *Working session* and *Last seen*
  rows, which `ExecutionPanel` already has.

## Acceptance criteria

- [x] A task with a live agent claim returns `claim` with the holder's session,
      `last_heartbeat_at`, `connection` and `generation`; one without returns
      `null`. Asserted on a list read and a single read.
- [x] `connection` turns `suspect` past the suspect interval with an injected
      clock, on the task read.
- [x] An expired, released or transferred claim is not `claim` (history stays
      in activity).
- [ ] Repo-root gate: red only on the client mirror assertion, quoted
      verbatim, for SHELL's half.

  **Not met as written — unticked after review (Codex on PR #112).** The only
  red this branch adds is these two lines in
  `server/web/test/api/view-type-drift.test.ts` (*"no server field is missing
  from its client type"*):

  ```
  TaskView.claim is served and Task does not declare it — add it, or list it in clientOmits with a reason
  TaskSummaryView.claim is served and TaskSummary does not declare it — add it, or list it in clientOmits with a reason
  ```

  The repo-root gate also fails five server/web tests that fail identically
  without this branch: *activity wording covers the server’s vocabulary*,
  *every served endpoint has a caller, or a named reason*, *the stream
  subscribes to exactly what the server emits*, *every server field is visible
  to the client* (its pre-existing `TaskView.selected_agent`,
  `TaskSummaryView.selected_agent` and `EventView.agent_id` lines), and
  *describeProjectEvent*. Measured: server/web `# pass 3365`, `# fail 5` at
  this branch's head, and the same five `not ok` with `# pass 3365`, `# fail 5`
  when `server/src/services/{claims,tasks}.ts` were put back to `7fcdfa81` —
  the claim commit, which differs from base `01618534` only by this task
  file. (Not a separate clean checkout: §4.2 forbids a builder creating a
  worktree.) They are the missing client halves of LAI-534/535/541. **This
  criterion is to be re-validated after merging
  `origin/integration-agent-identities`, once Belka posts it ready.**

## Role / machine

CORE on Belka. Owner area: `server`.

Claimed by Strelka (D-097) on a branch cut from `origin/LAI-542-agent-session-helper` @ `01618534`, per the [belka] hand-off on LAIKA-820. The file was copied in from `origin/LAI-543-execution-states` (not in the base); that branch keeps a `backlog/` copy — the two-copy shape of §2, to be resolved by whoever merges.

## What was built (Strelka, CORE)

- `server/src/services/claims.ts` — `TaskLiveClaimView` and `liveClaimViews(db,
  taskIds, now)`: one query per page (claims ⋈ agent_sessions ⋈ agents, live
  states only), keyed by task id. `isSuspect` is now the one rule
  `AgentSessionView` and the task's claim share.
- `server/src/services/tasks.ts` — `claim` on `TaskSummaryView` (so on
  `TaskView`, the slim list, and every write's answer). `loadViewContext` takes
  the read's `now`; `getTask(…, now?)`, `ListTasksFilter.now`,
  `ListAllTasksFilter.now` and `viewTasks(…, now?)` default to `Date.now()`, and
  each write's view uses that write's own `now`.

**What `claim` is**: the task's `active` or `paused` claim, with the holding
session's `last_heartbeat_at`. **Null** when there is none, and also for an
`active` claim whose lease has lapsed **before the scan has marked it**
(`leaseLapsed`, so the boot grace applies): the fence already refuses that
generation, and a card should not say *Working* for it. A claim whose session
**ended** while the claim stayed live — only a revoked agent's, which D-114 item
2 leaves to lapse — is served `connection: 'suspect'`: nothing will renew it.

**Choice for the client's clock: `suspect_after_ms` on the claim**, not a
re-read guarantee. Heartbeats write no activity, so nothing would prompt a
re-read; the client compares `now - last_heartbeat_at >= suspect_after_ms`
itself. `connection` is still served, computed at the read, so a client that
does not tick gets the right answer as of its last read.

**Tests** — `server/test/services/claims.test.ts` *"the live claim on a task
read (LAI-568)"*, injected clock. **On both `getTask` and `listTasks`**: full
shape; null unclaimed; `suspect` at the interval; null once lapsed (before and
after the scan), released (finish, and ended session) and transferred; paused
served; revoked agent → suspect; after a reclaim under a new session, only
generation 2's session and heartbeat, though the old session beat later.
**On `getTask` only**: `live` at `suspect − 1`, and `live` again after a
heartbeat. **On `listTasks` only**: a page of several claimed tasks each gets
its own. **On `liveClaimViews` directly**: one prepared statement for one task
and for five (the driver instrumented as LAI-091's test in `tasks.test.ts`
does); a deliberate per-task loop turned it red with 5, and the file was
restored and checksum-verified. `server/test/http/routes/agent-sessions.test.ts`
*"the live claim on task reads (LAI-568)"*: `GET /tasks/:id`, the full list and
`?fields=slim` all carry it, null on a free task, null after `POST
/tasks/:id/finish`, null after the scan. Mutations run against the three
filters in `liveClaimViews` (lapse skip, `>=`→`>`, live-state predicate) each
turned the intended tests red.

`TaskLiveClaimView` is in `response-type-coverage.test.ts`'s `UNPAIRED` as
`no client type exists` (CORE's file, the LAI-535 `SelectedAgentView` shape);
it self-expires the moment SHELL's `PAIRS` pairs it.

## Gate (repo root, after the last code edit)

```
pnpm test   > /tmp/lai568-test.txt 2>&1   TEST 1
pnpm lint   > /tmp/lai568-lint.txt 2>&1   LINT 0
pnpm format > /tmp/lai568-fmt.txt  2>&1   FMT  0
```

server: `Test Files 205 passed | 2 skipped (207)`, `Tests 4079 passed | 10
skipped (4089)`. cli: `# tests 667, # pass 665, # fail 0, # skipped 2`.
server/web: `# tests 3370, # pass 3365, # fail 5`.

**This branch's own red is the client mirror only**, in
`server/web/test/api/view-type-drift.test.ts` *"no server field is missing from
its client type"* — these two lines, verbatim, are the ones this task adds:

```
TaskView.claim is served and Task does not declare it — add it, or list it in clientOmits with a reason
TaskSummaryView.claim is served and TaskSummary does not declare it — add it, or list it in clientOmits with a reason
```

**The five failing web tests are inherited from the base**
(`LAI-542-agent-session-helper` @ `7fcdfa81`), measured by running
`pnpm --filter @laika/web test` with `server/src/services/{claims,tasks}.ts` at
`7fcdfa81`: the same five `not ok` (`activity wording covers the server’s
vocabulary`, `every served endpoint has a caller, or a named reason`, `the
stream subscribes to exactly what the server emits`, `every server field is
visible to the client`, `describeProjectEvent`), `# fail 5`, and the drift
assertion listing `TaskView.selected_agent`, `TaskSummaryView.selected_agent`,
`EventView.agent_id` without the two `.claim` lines. They are LAI-534/535/541's
client halves (agent endpoints, `task.agent_selected`, `task.claim_expired`,
`task.claim_reclaimed`, `selected_agent`), not this task's.

## Notes for Belka (SPEC half)

Proposed wording; CORE does not edit `docs/`.

**§6.4, the derived-fields table under the task shape** — a row after
`selected_agent`:

> | `claim` | the task's **live** claim (§4.66) — `active` or `paused` — as `{ generation, state, agent_id, session_id, lease_expires_at, last_heartbeat_at, connection, suspect_after_ms, device_label }`, or `null` (LAI-568). `last_heartbeat_at` is the holding session's (§4.65); `connection` is `live` or `suspect` by §9.1.1's suspect interval at the moment of the read, and `suspect` too when the session has ended while the claim waits to lapse (a revoked agent's); `suspect_after_ms` is that interval, so a client moves `live` to `suspect` on its own clock — heartbeats write no activity, and nothing re-reads the task for it. `device_label` is the holding agent's (§4.63). An `active` claim whose lease has lapsed is `null` before the scan marks it `expired`; an expired, released or transferred claim is never `claim` — its history is the task's activity |

**§4.66 `task_claims`**, a sentence after the table:

> The live claim is served on every task read as `claim` (§6.4, LAI-568) — to
> people as well as agents; `TaskClaimView` stays the holder's own answer.

**§9.1.1**, on the *Connection suspect* row's note, optionally:

> … shown, decides nothing; served on the task as `claim.connection`, with the
> interval as `claim.suspect_after_ms` (§6.4).

## Notes for SHELL (client half, §4.4)

Mirror `claim` on `Task` / `TaskSummary` in `server/web/src/api/`, add a
`PAIRS` entry `server: 'TaskLiveClaimView'` (which retires its `UNPAIRED` row in
`response-type-coverage.test.ts` — the staleness check there will say so), and
drive `cardExecutionState` from `claim` + `suspect_after_ms`.

This branch must be re-based **by merge** onto `integration-agent-identities`
when Belka posts it ready.
