---
id: LAI-1077
title: 'Developer access design: GET /project-setups lists my setups across every project I can read'
area: core
assignee: core/belka
priority: p2
depends-on: []
discovered-from: LAI-1075
status: in-progress
started: 2026-11-02T10:25:28+05:30
---

## Why

The owner's V3 design (`~/Downloads/laika-developer-access-v3.html`, plan
`~/.claude/plans/we-have-match-this-lovely-torvalds.md`) puts the reader's
repository setups on the Overview (a count, the third journey step, a list)
and gives Project setup a list view. Today `GET /api/v1/project-setups`
requires `project` (`server/src/http/routes/project-setups.ts`), so the web
would need one request per project.

## Acceptance criteria

- [ ] `GET /api/v1/project-setups` with no `project` returns the caller's own
      records across every project they can read, newest first, paged as the
      per-project read is, same row shape plus the project's slug and name.
- [ ] The per-project form (`?project=`, `?agent_id=`) is unchanged.
- [ ] Every row's project passes the same `can()` the per-project read asks;
      a project the caller cannot read contributes nothing and is not named.
      `agent_id` without `project` filters to that tool, the caller's own.
- [ ] SPEC §6 row describes the optional `project`; route census, parity and
      response-type tests updated; server tests cover: two projects, one
      unreadable, another user's records never returned, paging, agent filter.
- [ ] The web client `listProjectSetups` accepts no project.

## Notes

- CORE, `server/` (plus `docs/SPEC.md` §6 row, a named edit) and the one
  client function in `server/web/src/api/project-setups.ts` (named edit).
- Data access: needs an independent review before merge.
- PR into `integration-dev-access-design`.
