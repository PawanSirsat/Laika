---
id: LAI-226
title: Two `listProjects` functions for one endpoint, and the narrow one drops fields
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-423
status: backlog
---

## Goal

`GET /api/v1/projects` has **two** client functions with the same name and
different return types:

| | returns | fields |
| --- | --- | --- |
| `api/projects.ts:96` | `Page<ProjectRow>` | the full view, including `last_activity_at`, plus tombstones |
| `api/tasks.ts:263` | `Page<ProjectSummary>` | `id`, `slug`, `name` — **and nothing else** |

`ProjectSummary` is not a documented projection of anything. It is a hand-written
subset that silently omits every other field the endpoint returns, and it has no
tombstone handling at all — so a caller using it cannot tell a deleted project
from a live one.

**This was not theoretical.** LAI-423 needed `last_activity_at` to stop the board
falling back to the alphabetically-first project. `BoardScreen` imported the
`tasks.ts` one, so the field was not on the type and the shared rule could not
compile there. Board now uses `api/projects.ts`; the duplicate is still there for
the next caller to pick by accident.

The nearest existing guard does not catch it: `view-type-drift.test.ts` (LAI-213)
compares client types against the **server's** view types, and `ProjectSummary`
is not paired with anything, so it drifts unwatched.

## Acceptance criteria

- [ ] One `listProjects`. If a narrow shape is genuinely wanted, it is derived
      from the full one (`Pick<Project, …>`) rather than hand-written, so a
      server field cannot go missing from it silently.
- [ ] Every caller uses it, and tombstones are handled the same way at each —
      today `BoardScreen` filtered none, `SprintsScreen` filtered with
      `isProject`.
- [ ] `ProjectSummary` is either paired in `view-type-drift.test.ts` or gone.
      An unpaired client type is the exact gap LAI-213 exists to close.
- [ ] Full gate green.

## Notes

Found while fixing LAI-423. Not fixed there: LAI-423 is a p1 defect the owner
hit, and collapsing a duplicated API function touches every screen that lists
projects — a separate change with its own review.

`api/tasks.ts` holding a *project* listing at all is worth a moment's thought
while doing this. It is there because the board needed it and the board is a
task screen; that is not a reason for it to stay.
