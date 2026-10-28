---
id: LAI-586
title: 'The selected agent owns the claim (D-119) and sessions carry harness, version and model (D-118) — server half'
area: server
assignee: core
priority: p1
depends-on: [LAI-535, LAI-541]
discovered-from: LAI-532
status: review
finished: 2026-10-28T21:29:06Z
started: 2026-10-28T20:54:12Z
---

Implements **D-119** and the server half of **D-118**, both *proposed* in
`docs/proposals/LAI-532-agent-identity-model.md` (PR #121, branch
`LAI-532-identity-model-decisions`). Built behind no flag; the PR stays
reviewable and **merging waits for the owner's approval of D-118 / D-119**.

`depends-on`: LAI-535 and LAI-541 are merged into `master` (PRs, deployed) and
sit in `.tasks/review/` there, not `done/` — recorded as the deviation §2 asks
for; this task builds on the code, which is on `master`.

## Goal

Once a task names its agent, only that agent can start it; and every agent
session says, self-reported, which harness, version and model actually ran,
so the board can answer "what exactly ran?" one click away.

## Acceptance criteria

- [x] D-119: when a task has a selected agent, only sessions of **that** agent may claim it — REST `POST /tasks/:id/claim`, MCP `start_working`, and the reclaim (REST `POST /tasks/:id/claim/reclaim`, MCP `start_working` `reclaim: true`). Any other agent gets `409 conflict` with `details.reason: selected_for_another_agent`
- [x] The refusal names the selected agent (`selected_agent_id`, `selected_agent`) only when the caller may read the task's project; it is asked only after the caller's own `task.claim` permission, so a caller who may not claim hears that and nothing about the selection
- [x] No selected agent → any eligible agent may claim, unchanged; a person and a legacy token claim as before
- [x] Changing or clearing the selection while another agent holds a live claim stays refused (`claim_held`, existing rule)
- [x] Reads and comments are never blocked
- [x] A claim by the selected agent accepts its open work request; a non-selected agent can no longer leave the selected agent's request open beside its claim (the 2026-10-29 case)
- [x] D-118: `agent_sessions` gains nullable `harness` and `harness_version` (it already has `model` and `client_version`); additive migration, every existing row kept
- [x] `POST /agent-sessions` and `POST /agent-sessions/:id/heartbeat` accept `harness`, `harness_version`, `model` (the model may change mid-session), validated for format and length, never used for authorisation
- [ ] The session fields are exposed on `GET /agents/:id` sessions, on the task's claim information, and on activity rows written by an agent session (a snapshot at the time of the action; old rows are not back-filled)

  **Partly met — unticked on purpose.** `GET /agents/:id` → `sessions` and every activity row's `agent_session` are served. **The task read's claim information is not**: LAI-568 (in review, branch `LAI-568-task-view-live-claim`) adds `claim` to `TaskView` and rewrites the same part of `services/claims.ts`; adding a second claim field beside it would collide. Filed **LAI-593** (depends on LAI-586 and LAI-568) to put `harness`, `harness_version`, `model` on LAI-568's `TaskLiveClaimView`. The claim a session takes still answers its own `session_id`, and the session itself carries the fields.
- [x] SPEC: only the sections the guards force, quoting the proposal
- [x] Tests: REST + MCP for D-119 (selected agent claims; other agent refused with reason; no selection → anyone eligible; no leak; work request state), session metadata round-trip, migration on a populated database keeps every row; each rule broken on purpose and the matching test seen red
- [x] The web half (client types, cards, drawer, activity) is LAI-587; the CLI helper is LAI-588 — neither is touched here (§4.4)

## Notes / context

- Owner direction 2026-10-29, via the polly manager session. Card parent LAIKA-785.

## Delivered

### Named cross-area edits (D-033 / D-034)

`docs/SPEC.md`, these places only, each quoting the proposal:

- §4.8 `activity` — rows for `agent_session_id`, `session_harness`, `session_harness_version`, `session_model` (the schema drift guard requires them)
- §4.65 `agent_sessions` — rows for `harness`, `harness_version`; `model` gains *may change on a heartbeat*
- §6.3 claim-fence reason table — the `selected_for_another_agent` row
- §6.4 — the two `/agent-sessions` endpoint lines; the selected-agent paragraph (D-119); the sessions paragraph (session shape, `GET /agents/:id` `sessions`, activity `agent_session`)
- §7.1 `start_working` row — one sentence for D-119

### §4.4 — the web half is red on purpose

The repo-root gate is red **only** on this assertion in
`server/web/test/api/view-type-drift.test.ts` (*"no server field is missing
from its client type"*), quoted from the gate:

```
EventView.agent_session is served and ActivityEvent does not declare it — add it, or list it in clientOmits with a reason
```

`clientOmits` lives in `server/web/` (SHELL's), so there is no exemption CORE
can take. **LAI-587** (SHELL) mirrors `agent_session` on `ActivityEvent` and
turns it green. `AgentDetailView` and `ActivitySessionView` are listed in
`UNPAIRED` (`server/test/tooling/response-type-coverage.test.ts`, CORE's) until
LAI-587 brings their client types.

### Deviations

- `depends-on: [LAI-535, LAI-541]` are merged into `master` and deployed but sit in `.tasks/review/` there, not `done/`.
- Filed on the board first as LAI-586 by this session; another session's card held LAI-586 for ~30 s (it is now LAI-589, LAIKA-840) and yielded. LAIKA-841 and LAIKA-842 (LAI-587, LAI-588) were created during that window and carry `blocked_by` LAIKA-840; commented on both. `update_task` cannot change `blocked_by`.

### Known limitations

- A person and a legacy token are not refused by D-119: they claim by assignee, as before (D-119 speaks of agents; D-114 item 6 already keeps a legacy token off a live claim).
- MCP `start_working` opens a session with no self-reported fields; the helper (LAI-588) and `POST /agent-sessions` are where they are reported.
- The `project.read` gate on naming the selected agent is defence in depth: every caller who reaches it has already passed `task.claim`, so a mutation of it alone is not observable through the claim routes; the ordering (D-119 asked after `task.claim`) is what the no-leak tests pin.

## Review round 1 — cross-vendor review of PR #123 at 963a2d68, two blockers (2026-10-28T22:30:52Z)

**1. A non-selected holder could renew.** Removed the exemption: `start_working`
with the holder's own `session_id` is refused `selected_for_another_agent`.
**What happens to that claim** (taken before D-119 or before the selection; the
API cannot make one now): never renewed, never usable — the claim, the reclaim
and the fence all refuse it — and it **ends as `released`** at the holder's next
heartbeat (reported in `lost`) or when its lease lapses, whichever is first,
recorded by the system as `task.updated` `{ field: 'claim', from, to: null,
reason: 'selected_for_another_agent' }`. **Released, not expired**: an expired
claim waits for its holder's reclaim or for recovery, and this holder may never
reclaim, so `expired` would lock the selected agent out of its own task until a
person moved it. While it is live the selected agent hears `claim_held`; it is
never taken over (a takeover is a hand-off, LAI-546).

**2. Hidden versus missing.** `POST /tasks/:id/claim`, the REST reclaim and MCP
`start_working` (with and without `reclaim`) answer a task the caller cannot
read **byte for byte** as one that does not exist: `404 not_found`, `No such
task`, no id, no agent. Asked before `task.claim`; the reclaim checks the caller
first, then visibility. Tested with an agent with no grant, a personal token
pinned to another project, and over MCP by key and by id.
**Changed contract:** a reclaim after the grant was removed is now that `404`,
not `403 agent_not_granted` — `test/services/claims.test.ts` updated with the
reason; SPEC §6.4 says so.

**Bypass cases.** A status change to in progress takes no claim (the selected
agent then claims normally); a heartbeat of a session holding nothing takes
nothing; finishing into review by an agent holding nothing is already `403`
under §5's review rule and takes no claim; finishing under a non-selected claim
is refused by the fence.

**Mutations** — each seen red, file restored and checksummed: renewal exemption
back; heartbeat renewing; lease end expiring instead of releasing; fence
letting it change the task; visibility check gone; hidden and missing worded
differently; the release writing no record; plus D-119 off on claim and on
reclaim, and the refusal never naming the agent.

## Review round 2 — PR #123 at 1d128efd, two blockers (2026-10-28T23:43:17Z)

**1. The assignee rule hid D-119.** `agentStartWorking` now asks
`assertSelectedAgentMayClaim` before the assignee check — after visibility
and `task.claim`, which `startWorking` asks first, so a hidden task still
answers as a missing one. A non-selected agent on a task assigned to another
person hears `selected_for_another_agent`; the selected agent meets the
assignee rule as before (its open request lets it claim); with no selection the
bare `assignee_id` conflict is unchanged. REST and MCP.

**2. The reclaim left a re-issued request open.** `reclaimTask` accepts the
agent's open work request in the same transaction as the new claim, exactly
as a fresh claim does. Select A → A claims → expire → select B → select A → A
reclaims: A's new request is `accepted`. REST and MCP.

**Non-blocking:** one criterion added to LAI-588 (SHELL, still in backlog,
unclaimed): the helper's lost-claim notice tells `released` (do not reclaim)
from `expired`. `cli/` untouched.

**Mutations:** D-119 removed from before the assignee rule; the reclaim's
request acceptance removed — each red in REST and MCP, restored and checksummed.
