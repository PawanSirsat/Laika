---
id: LAI-836
title: 'SPEC §4 and §6.4 for LAI-831''s server additions: breaks, undo, a block''s span, drafts held'
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-831]
discovered-from: LAI-831
status: backlog
---

## Goal

LAI-831 (owner-direct, My day v2) added to the server what the owner's design
and CHIEF's additions B, C, D and F needed. `docs/` is CHIEF's, so the SPEC
half is this task. The two new tables carry an exemption in
`server/test/tooling/schema-spec-drift.test.ts`'s `TABLES_NOT_IN_SPEC` that
names this task; it goes stale — and must be removed — once §4 describes
them.

## What to write (LAI-831's task file, *Server changes*, is the record)

- **§4**: `time_breaks` (a gap a person waved away; per person and day; kept
  30 days with drafts) and `time_undo` (a change's before-image, kept
  minutes; the person's own).
- **§6.4**: `POST /me/time-breaks`, `DELETE /me/time-breaks/:id`,
  `POST /me/time/undo`; `started_at` and `ended_at` on `PATCH
  /me/time-drafts/:id` and `PATCH /me/time-entries/:id`; `breaks` and
  `drafts_held` on `GET /me/time`.
- **§11.6**: both tables in time retention.

## Acceptance criteria

- [ ] §4, §6.4 and §11.6 say the above, quoting the code.
- [ ] The two `TABLES_NOT_IN_SPEC` entries go stale the moment §4 describes
      the tables (the staleness guard says so); they are removed in the merge
      that lands this, by §4.4's procedure.
- [ ] The gate exits 0.
