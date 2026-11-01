---
id: LAI-1057
title: 'Close the GET→PUT race on agent grants: a single-project grant write, or If-Match on PUT /agents/:id/grants'
area: core
assignee: unclaimed
priority: p2
depends-on: [LAI-1052]
discovered-from: LAI-1052
status: backlog
---

## Why

Project setup (LAI-1052) changes one project's grant through the existing
whole-set `PUT /api/v1/agents/:id/grants`. To avoid losing other projects'
grants it re-reads `GET /agents/:id` immediately before the write and
replaces only the one project (proved by `project-setup.test.ts`, *a grant
made elsewhere after the page loaded survives Save*).

A window remains between that `GET` and the `PUT`: a grant written by
another tab or session in between is overwritten. Plan LAI-1042 §E.5
proposed `PUT /api/v1/agents/:id/grants/:project_id`; the LAI-1052 brief
chose to reuse the existing route rather than add one.

## Acceptance criteria

- [ ] Either a per-project upsert/delete
      (`PUT /agents/:id/grants/:project_id`, body `{ scope: read_only|full|null }`,
      session only, `agent.manage_own`, the same project validation as
      `setAgentGrants`), **or** a precondition on the existing route
      (`ETag` on `GET /agents/:id` and `If-Match` on `PUT /agents/:id/grants`,
      `412` on a mismatch). The owner picks; record it.
- [ ] A test that interleaves two writers and proves neither grant is lost
      (or the stale one is refused with its exact code and reason).
- [ ] SPEC §6.4 row (CHIEF), and the web client switched over in a SHELL
      follow-up or the same multi-owner PR (§4.4).
- [ ] Classic *Manage access* keeps working unchanged.
