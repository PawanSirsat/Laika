---
id: LAI-976
title: 'Spaces cannot be renamed, recoloured, re-keyed, archived from a screen, left, or given per-space rules — the API half'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

D-103 server half. The audit of 2026-10-22 found: PATCH /projects refuses
`board_hide_done_days` (bug since LAI-266), slug/prefix, has no colour; no
leave endpoint; archived spaces vanish from lists; no per-space rules.

## Acceptance criteria

- [ ] **Bug:** `PATCH /api/v1/projects/:slug` accepts `board_hide_done_days`
      (test red first).
- [ ] PATCH accepts `name`, `description`, `repo`, `color` (fixed palette
      enum — builder takes the 8 values from the design: black, violet, teal,
      blue, amber, magenta, red, green, as tokens), and `prefix` per D-103 item
      3: old keys keep resolving everywhere a key is accepted (REST
      `/tasks/:key` lookups, MCP tools, `external_ref` matching, links). Builder
      first reports how keys are stored today; if per-task keys are derived from
      the current prefix, introduce stored per-task key prefixes or a key
      alias table — whichever is smaller and correct — with a migration; if not
      guaranteeable, refuse `prefix` changes with `422` and say why.
- [ ] `color`, `task_create_min_role` (`member` | `lead`), `agents_allowed`
      (boolean, default true) stored per project (migration), returned on the
      project view.
- [ ] `can()`: task creation honours `task_create_min_role` (viewers never);
      with `agents_allowed = false`, agent tokens are refused claim / start /
      create / update / finish / comment-write in that project (reads allowed);
      people unaffected. Every path: REST, MCP, imports. Codes asserted.
- [ ] `POST /api/v1/projects/:slug/leave` (or `DELETE …/members/me`): any
      member; last lead `409` with `details.reason: last_lead` and a message
      naming what to do; org owner/admin response says implicit access remains
      when they hold *Open every project*.
- [ ] `GET /api/v1/projects?archived=include|only` for callers allowed to see
      archived spaces (`project.archive` holders and members of the space);
      default unchanged. Archive/unarchive via PATCH `{archived}` as today.
- [ ] **Named cross-area edits (D-033):** SPEC §3.2 rows *Leave a project*,
      *Create tasks* (per-space minimum) and the agent rule; §4 project columns;
      §6.4 lines. Nothing else in `docs/`.
- [ ] Gate; web drift/coverage failures for LAI-977/978 quoted per §4.4.
