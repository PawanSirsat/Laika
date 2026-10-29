---
id: LAI-535
title: 'Selected agent and work requests on tasks; activity.agent_id attribution; verb agent_selected'
area: server
assignee: core
priority: p1
depends-on: [LAI-534]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-27T21:02:11Z
finished: 2026-10-27T21:40:42Z
---

Implements **proposal §3, §4.1 (attribution), §4.4 (verbs)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A task can name the agent intended to do it. Selecting one records a
work request — it claims nothing and starts nothing — and every activity row
written by an agent token carries which agent wrote it.

## Scope

- Migration: nullable `tasks.selected_agent_id`, nullable `activity.agent_id`.
- Task write path accepts `selected_agent_id` (REST + the MCP task tools), checks the agent is eligible (active, granted on the project, owner may act).
- Selecting writes an `agent_selected` activity row in the same transaction.
- Every activity row written with an agent token sets `activity.agent_id`; historic rows stay null.
- Changing the selected agent while a claim is live is refused once LAI-541 exists; until then the field is free to change.

## Out of scope

- Claims, leases and fencing (LAI-541).
- The UI (LAI-538).

## Acceptance criteria

- [x] `PATCH` with an ineligible agent answers `422` with a specific `code` naming why (revoked, no grant, wrong org).
- [x] Selecting an agent does not change `assignee_id` or any claim field (asserted).
- [x] `agent_selected` is in `ACTIVITY_TYPES` and the DB CHECK, and the SPEC §4.8 row from LAI-533 matches it (drift guard green).
- [x] An activity row written by an agent token has `agent_id` set; one written by a legacy token has `agent_id` null (both asserted).
- [x] No migration back-fills `activity.agent_id` (asserted by reading the generated SQL).
- [x] Repo-root gate exits 0 — or red only on the `server/web/` client-mirror assertion, quoted here verbatim, which LAI-538 turns green (§4.4 step 1).

## Tests and UI evidence required

Route + MCP tests for selection and eligibility; activity attribution test; enum/SPEC drift guard.

## Dependencies

`depends-on: [LAI-534]`.

**Blocked on decision D-114 (proposed).** Do not start until D-114 is approved as proposal §8 describes (a web-session comment with `actor_kind: user` on the LAI-532 card, or an Approved GitHub review by PawanSirsat). Board tag `blocked-on-decision`.

`agent_selected` is three-owner (CLAUDE.md §4.4): **LAI-533** (SPEC §4.8 row), **LAI-535** (enum + CHECK, this task), **LAI-538** (client mirror + wording).

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1.5–2 days, confidence M.

## Branch

`LAI-535-selected-agent`

## Migration / rollout notes

Additive, nullable. Three-owner merge per CLAUDE.md §4.4: CHIEF merges this half to local `master` unpushed; LAI-538 merges it and completes the client mirror; CHIEF pushes both as one green state.

## Notes

- **Claimed by CORE (polly dispatch), 2026-10-28.** Worktree
  `Laika-selected-agent`, branch `LAI-535-selected-agent-work-requests` (the
  dispatch's name, not the `LAI-535-selected-agent` this file suggests), cut
  from LAI-534's head `63dff7e3` (draft PR #102, itself on #98 and #96).
- **Deviation, recorded as §2 asks:** `depends-on: [LAI-534]` is in
  `.tasks/review/`, not `done/`. CHIEF dispatched this against it, stacked on
  #102; the PR must not merge before #102.
- **D-114** is approved in substance (2026-10-28); the authorised-account
  record is pending, so the PR stays a draft.

## Submitted (CORE, 2026-10-28)

**Names.** Column `tasks.selected_agent_id` (FK agents, set null). Column
`activity.agent_id` (FK agents, restrict, never back-filled). Table
`handoff_offers`, the §4.4 shape cut to a work request: `id, task_id, kind,
to_agent_id, state, created_by_user_id, created_at, closed_at`, with at most
one open `work_request` per task (partial unique index). Migration `0062`.
`PATCH /tasks/:id { selected_agent_id }`, and a new endpoint
`GET /api/v1/agents/me/work-requests`, which only an agent's token can call.
MCP: `update_task { agent }`. `list_ready_tasks` now returns `work_requests` on
an agent's token, and `get_task_context` names the selected agent.
`TaskView.selected_agent`, `EventView.agent_id`. Verb `task.agent_selected`.
No new §3.1 action: selecting is `task.write`.

**Deviations, for the reviewer.**
- **The verb is `task.agent_selected`, not `agent_selected`.** Every verb in
  `ACTIVITY_TYPES` is dotted, and activity is append-only, so the name can
  never be changed later. LAI-538 mirrors this name.
- The 422 refusal uses `details.reason`, not a new `code`, because §6.3's
  codes are closed (D-021). It has the same shape as `assignee_id`'s
  `not_on_project`. The reasons are `agent_not_found`, `agent_other_owner`,
  `agent_wrong_org`, `agent_revoked`, `agent_not_granted`, `agent_read_only`
  and `agents_off`.
- `handoff_offers` has no §4 section yet. I wasn't granted a named crossing
  for a new one, so it is covered by a `TABLES_NOT_IN_SPEC` entry. LAI-544
  writes the section, and the staleness guard then drops the entry.
- The claim seam is `assertSelectionChangeAllowed`, currently a no-op. Its
  test is named `TODO(LAI-541, LAI-546)`.
- I touched four CORE files outside the feature, because a new
  `activity`/`tasks` column breaks fixtures that cut the migrations back:
  - `db/backfill.ts` now selects only the three columns it reads.
  - `readPayload` takes `Pick<Activity, 'payloadJson'>`.
  - The 0029, D-093 and 0061 migrate fixtures, and the activity rowid replay
    test, use raw SQL. The 0061 test now brings back only its own migration.

**Red on the gate, all `server/web` (SHELL), and all caused only by this
three-owner verb or the new server fields/endpoint (§4.4 step 1).** Quoted
exactly:

1. `activity-labels`, *"every type the server emits has wording"*. LAI-538:
   ```
   + [
   +   'task.agent_selected'
   + ]
   ```
2. `dashboard-derive.test.ts`, *"covers every verb the server can write"*,
   message `these §4.8 verbs have no wording on the dashboard`. LAI-538:
   ```
   + [
   +   'task.agent_selected'
   + ]
   - []
   ```
3. Stream types, *"STREAM_TYPES equals ACTIVITY_TYPES, in order"*. LAI-538:
   ```
   -   'task.agent_selected'
   ```
4. Client/server drift, *"no server field is missing from its client
   type"*. LAI-538:
   ```
   +   'TaskView.selected_agent is served and Task does not declare it — add it, or list it in clientOmits with a reason',
   +   'TaskSummaryView.selected_agent is served and TaskSummary does not declare it — add it, or list it in clientOmits with a reason',
   +   'EventView.agent_id is served and ActivityEvent does not declare it — add it, or list it in clientOmits with a reason'
   ```
5. `endpoint-coverage.test.ts`, *"no endpoint is served, uncalled and
   unexplained"*. The first five lines were already red from LAI-534 and
   belong to LAI-561. The last line is new and belongs to **LAI-566**, filed
   from this task:
   ```
   +   'api/v1/agents',
   +   'api/v1/agents/*',
   +   'api/v1/agents/*/grants',
   +   'api/v1/agents/*/revoke',
   +   'api/v1/agents/*/rotate-token',
   +   'api/v1/agents/me/work-requests'
   ```

The `server` and `cli` workspaces are green. Lint and format exit 0.


## Review follow-ups (CORE, 2026-10-28)

Codex reviewed PR #105 twice, and each round was fixed in new commits only.

- **At `38ab6851` (PASS, two non-blocking items).**
  - `list_ready_tasks` now applies `project` and `limit` to `work_requests`. The REST twin takes `?project=`.
  - Added a pagination regression test: requests at one timestamp, read across continuation cursors.
- **At `1f146d93` (FAIL, one blocking item: project-existence probing).**
  - The bug: the slug was looked up before authorisation, so an existing project the agent has no grant on answered `403 agent_not_granted`, and a made-up slug answered `404`.
  - The fix: the slug is now resolved only among the projects the agent may read (its grants ∩ its owner's `project.read`, with `can()` applying the token's own narrowing).
  - Real-but-ungranted and made-up slugs now get one refusal, the same on both: `403 forbidden`, `{ action: 'project.read', reason: 'agent_not_granted' }`, with no slug or id in the body. 403 is how `can()` already answers an agent outside its grants.
  - MCP `list_ready_tasks` asks the work-request question first on an agent's token, so its `project` argument gives the same answer before the task list's own lookup can run.
  - Regressions assert identical status and body over REST, and identical content over MCP. Reintroducing the lookup before authorisation turned both red; the file was restored and checksum-verified.
  - SPEC §6.4 is updated.

**Not changed, and outside this task.** The rest of the API still answers a real-but-unreadable project slug `403` and an unknown one `404`. For example, `GET /projects/:slug` and the task list for a legacy token or a person. That is the existing convention and was left alone; only this endpoint and the agent path of `list_ready_tasks` are made uniform here.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #105, #111.
