---
id: LAI-535
title: 'Selected agent and work requests on tasks; activity.agent_id attribution; verb agent_selected'
area: server
assignee: core
priority: p1
depends-on: [LAI-534]
discovered-from:
status: in-progress
started: 2026-10-27T21:02:11Z
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

- [ ] `PATCH` with an ineligible agent answers `422` with a specific `code` naming why (revoked, no grant, wrong org).
- [ ] Selecting an agent does not change `assignee_id` or any claim field (asserted).
- [ ] `agent_selected` is in `ACTIVITY_TYPES` and the DB CHECK, and the SPEC §4.8 row from LAI-533 matches it (drift guard green).
- [ ] An activity row written by an agent token has `agent_id` set; one written by a legacy token has `agent_id` null (both asserted).
- [ ] No migration back-fills `activity.agent_id` (asserted by reading the generated SQL).
- [ ] Repo-root gate exits 0 — or red only on the `server/web/` client-mirror assertion, quoted here verbatim, which LAI-538 turns green (§4.4 step 1).

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

