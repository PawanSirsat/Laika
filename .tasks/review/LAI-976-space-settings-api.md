---
id: LAI-976
title: 'Spaces cannot be renamed, recoloured, re-keyed, archived from a screen, left, or given per-space rules — the API half'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-22T17:10:09Z
finished: 2026-10-22T17:55:57Z
---

## Goal

D-103 server half. The audit of 2026-10-22 found: PATCH /projects refuses
`board_hide_done_days` (bug since LAI-266), slug/prefix, has no colour; no
leave endpoint; archived spaces vanish from lists; no per-space rules.

## Acceptance criteria

- [x] **Bug:** `PATCH /api/v1/projects/:slug` accepts `board_hide_done_days`
      (test red first).
- [x] PATCH accepts `name`, `description`, `repo`, `color` (fixed palette
      enum — builder takes the 8 values from the design: black, violet, teal,
      blue, amber, magenta, red, green, as tokens), and `prefix` per D-103 item
      3: old keys keep resolving everywhere a key is accepted (REST
      `/tasks/:key` lookups, MCP tools, `external_ref` matching, links). Builder
      first reports how keys are stored today; if per-task keys are derived from
      the current prefix, introduce stored per-task key prefixes or a key
      alias table — whichever is smaller and correct — with a migration; if not
      guaranteeable, refuse `prefix` changes with `422` and say why.
- [x] `color`, `task_create_min_role` (`member` | `lead`), `agents_allowed`
      (boolean, default true) stored per project (migration), returned on the
      project view.
- [x] `can()`: task creation honours `task_create_min_role` (viewers never);
      with `agents_allowed = false`, agent tokens are refused claim / start /
      create / update / finish / comment-write in that project (reads allowed);
      people unaffected. Every path: REST, MCP, imports. Codes asserted.
- [x] `POST /api/v1/projects/:slug/leave` (or `DELETE …/members/me`): any
      member; last lead `409` with `details.reason: last_lead` and a message
      naming what to do; org owner/admin response says implicit access remains
      when they hold *Open every project*.
- [x] `GET /api/v1/projects?archived=include|only` for callers allowed to see
      archived spaces (`project.archive` holders and members of the space);
      default unchanged. Archive/unarchive via PATCH `{archived}` as today.
- [x] **Named cross-area edits (D-033):** SPEC §3.2 rows *Leave a project*,
      *Create tasks* (per-space minimum) and the agent rule; §4 project columns;
      §6.4 lines. Nothing else in `docs/`.
- [x] Gate; web drift/coverage failures for LAI-977/978 quoted per §4.4.

## Builder notes (CORE, 2026-10-22)

**How keys were stored (reported before the change).** A task stores only
`number`; every key is `projects.prefix + '-' + number`, joined at read time
in ~15 places. Keys were resolved in four: `taskIdByKey` behind
`resolveTaskRef` (MCP tools, time entries, meeting reviews), `resolveKeys`
(token usage, time drafts, the Solidtime import), the heartbeat branch parser
(`resolveRepoProjects`, `resolveBranchTask` — heartbeats and the GitHub
webhook) and the collector's `task_prefixes`. REST `/tasks/:id` takes ids
only. So a new prefix re-keys every task.

**Approach: an alias list, not per-task prefixes.** `projects.former_prefixes`
(JSON array, migration 0051) holds every prefix the project carried; a new
`projectIdByKeyPrefix` tries the current prefix then former ones, and all four
resolution sites call it (or `keyPrefixesOf`). A prefix held now *or before*
by another project is refused `409` (`reason: 'former'` for the second), on
create and on re-key, so an old key can never name two tasks. A space may go
back to a prefix it held. **Display moves to the new prefix** (`COR-1` shows as
`ENG-1` and both resolve) — the alias table the criterion offers, not D-103's
literal "existing tasks keep their keys"; per-task stored prefixes would touch
every display site. CHIEF: say if the literal reading is wanted.

**Allowed red, per §4.4** — the client half (LAI-977/978), both in
`server/web/`, `cd server/web && pnpm run test` exit 1, 2991/2993:

```
not ok 1 - no endpoint is served, uncalled and unexplained
  served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
  + [ 'api/v1/projects/*/leave' ]
not ok 2 - no server field is missing from its client type
  ProjectSummary.agents_allowed is served and Project does not declare it — add it, or list it in clientOmits with a reason
  ProjectSummary.color is served and Project does not declare it — add it, or list it in clientOmits with a reason
  ProjectSummary.former_prefixes is served and Project does not declare it — add it, or list it in clientOmits with a reason
  ProjectSummary.task_create_min_role is served and Project does not declare it — add it, or list it in clientOmits with a reason
```

`LeaveProjectView` is named in the server's `UNPAIRED` (no client type
exists) and leaves it when LAI-977 builds the mirror.

## Review response (CORE, 2026-10-23) — release-2 cross-vendor review, PR #89

Two blocking items, fixed on `release2-spaces-server-fixes`. Criteria
unchanged.

**1. Agents-off bypass through offboarding.** Deactivating someone asks
`user.deactivate`, an org action, and `applyOffboardingChoice` then moved
their tasks in every space without asking any space. An owner's token
unassigned a task in an agents-off space. Now `applyOffboardingChoice` asks
the new `assertAgentsMay` (`policy/can.ts`, the agents rule alone, as
`task.write`) of every task's space **before the first write**. One such
task refuses the whole deactivation `403 forbidden`, `reason: 'agents_off'`,
and the transaction leaves the person active and every assignee as it was.
A person on a session, and a token where agents are on, are unchanged.

**Census: every write to `tasks` and its child tables in `server/src`.**
These are the writes to `tasks`, `task_dependencies`, `comments`, `task_tags`
and `time_entries`, by `.update/.insert/.delete`, plus raw SQL. The grep was
untruncated and found 31 sites:
- **Asks `assertCan` with the task's `projectId`**:
  - `createTask`, `updateTask`, `claimTask`, `changeStatus`,
    `reorderTask` and `removeTaskDependency` in `services/tasks.ts`.
  - `addDependency` (via `addTaskDependency`).
  - `setTaskTags` (via create and update).
  - `addTasksToSprint` and `removeTaskFromSprint`.
  - `addComment`, `editComment` and `deleteComment`.
  - `setSizeOverride` (via create and update).
  - `createTaskWithNumber` (via `createTask`).
  - Estimates `settle` and `freezeWhereMissed`: derived, and run inside the
    writes above or by the nightly job.
- **Member removal** (`removeMember`): asks `project.members.manage` of that
  space, so agents-off already refuses it. A test now asserts this.
- **Deactivation** (`setUserActive`, then `applyOffboardingChoice`): **was
  the bypass; fixed** as described above.
- **Heartbeats** (`recordHeartbeat`, `services/heartbeats.ts`): asks
  `heartbeat.send_own`, an org action, and then wrote `branch` onto the
  matched task. **The same bypass; fixed.** The beat still records and
  `matched_task_id` is kept. Only the task write is skipped when agents are
  off in that space.
- **The system principal, never an agent token**: `handlePullRequest`
  (GitHub webhook), `flagStaleTasks` and the retention delete in
  `jobs/jobs.ts`, `db/backfill.ts`, and migration 0045.
- **Not a write to a task**: `time-entries.ts` writes the caller's own
  timesheet (`time_entries.write_own`). It references a task and never
  changes it.
- **Project archive**: writes no task.
- **Imports**: meeting reviews and unlisted promote go through
  `createTask`/`updateTask`, as covered in round 1.

**Left as is, for CHIEF:** deactivation also deletes the person's
memberships in every space, agents-off spaces included. That is a membership
change, not a task change, so I did not gate it. If an agent token should not
be able to deactivate a member of an agents-off space at all, that is a
decision.

**2. Digit prefixes in branch names (absorbs LAI-177).**
- `parseBranchRef` now matches
  `(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,7})-(\d+)`. That is the
  `Prefix` shape in `routes/projects.ts`: a letter, then one to seven letters
  or digits. The prefix may not continue a word.
- `web2-1-fix` reads `WEB2`, `p0x-12-fix` reads `P0X` (not `X`), and
  `add-2fa-support` still reads `add`.
- Tests cover current and former digit prefixes, and narrowing a shared repo.
- SPEC §9.2 still writes `[a-z]+-(\d+)`. That is filed as **LAI-180**
  (area docs).

**Tests and mutations**, in `test/services/space-settings.test.ts`, 9 new
tests:
- Removing the offboarding check turns 1 red.
- Removing the heartbeat check turns 1 red.
- The old regex turns 4 red.

For each run the file was confirmed changed beforehand and restored after.
