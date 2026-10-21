---
id: LAI-844
title: 'SPEC §3.1, §3.4, §6.4 and §11.4.2 still describe Time without LAI-831''s breaks and undo, and §6.4 never listed an entry''s span or PATCH body'
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-836]
discovered-from: LAI-836
status: backlog
---

## Goal

Every place SPEC names the Time endpoints or the time retention job names
what the code serves today. LAI-836 wrote §4.55, §4.56, §6.4's Time prose and
§11.6 for LAI-831's additions, and was scoped to those sections; four other
passages now say less than the code, and one §6.4 line has said less since
LAI-787.

## What LAI-836 found (quoted from master `d36d2ee5`)

1. **§3.1, the time rows paragraph**: *"behind §6.4's `PUT /org/time`,
   `/me/time-settings`, `/me/time-drafts`, `/me/time` and
   `/me/time-entries`"*. `/me/time-breaks` is behind `time_drafts.manage_own`
   too (`server/src/services/time-breaks.ts:72`, `:127`).
2. **§3.4, the `system.time.prune` row**: *"§11.6: time retention — drafts
   after 30 days, entries after three years (D-088)"*. `pruneTime` also
   deletes `time_breaks` after 30 days and `time_undo` after
   `UNDO_WINDOW_MS` (`server/src/jobs/jobs.ts:234-239`).
3. **§11.4.2, My day's row** lists the endpoints the screen calls and omits
   `POST /me/time/undo`, `POST /me/time-breaks` and
   `DELETE /me/time-breaks/:id`, which `server/web/src/api/time.ts:333`,
   `:338` and `:342` call.
4. **§6.4's endpoint block**: `POST /api/v1/me/time-entries` is
   *"body { day, tz, minutes, task?, project?, note? }"*; the route also takes
   `started_at?` and `ended_at?` (`server/src/http/routes/time.ts:145-146`,
   there since LAI-787's `24c50360`), and the `PATCH …/:id` body
   (`time.ts:149-157`: `minutes`, `task`, `project`, `note`, `day`,
   `started_at`, `ended_at`) is listed nowhere as a body.

LAI-793 (backlog) asked for My day's §11.4.2 row; the row now exists on
`master` (✅ D-088, LAI-796), so item 3 may belong there instead — CHIEF's
call.

## Acceptance criteria

- [ ] §3.1's time paragraph names `/me/time-breaks` among the endpoints
      behind the time rows.
- [ ] §3.4's `system.time.prune` row names breaks and undo rows.
- [ ] §11.4.2's My day row names the undo and breaks endpoints.
- [ ] §6.4's `POST /me/time-entries` line names `started_at?` and
      `ended_at?`, and the `PATCH` body is stated, quoted from `time.ts`.
- [ ] The gate exits 0.

## Notes / context

`docs/` only. No guard reads any of these four passages today (LAI-836 swept
every test that reads `docs/SPEC.md`), so the change is checked by reading.
