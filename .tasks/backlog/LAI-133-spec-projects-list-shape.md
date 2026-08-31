---
id: LAI-133
title: SPEC §6.4 should carry the enriched projects list shape
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-053]
discovered-from: LAI-053
status: backlog
---

## Goal

LAI-053 enriched `GET /api/v1/projects`; §6.4 still describes the old six-field
shape. **`docs/` is CHIEF's**, so it travels.

No exemption is needed and master is green — the drift check compares §4 to
`schema.ts`, and nothing here is stored. Every added field is derived at read
time, which is the point.

## What the endpoint now returns per project

On top of the existing fields:

| field | derived from |
| --- | --- |
| `task_counts` | tasks by §4.5 status; **every status present, zero included** |
| `blocked_count` | tasks with ≥1 dependency that is not `done` (§4.6) |
| `member_count` | `project_memberships` |
| `members` | first 5 by name — `user_id` and `name` only |
| `last_activity_at` | `MAX(activity.created_at)` (§4.8), or `null` |

## Acceptance criteria

- [ ] §6.4 lists the fields with their meanings.
- [ ] It says `members` is **capped at 5** and `member_count` is the real total,
      so a client renders "+7" rather than assuming the list is complete.
- [ ] It says `blocked_count` counts **tasks, not edges** — one task blocked by
      three things is one blocked task.
- [ ] It records that **there is no live-agent field**, and why: heartbeats are
      M4 (D-023). A reader should not go looking for it, and a future one should
      know the omission was deliberate.

## Notes / context

Two decisions worth carrying into the prose because they are the ones a reader
would otherwise get wrong:

- **`last_activity_at` comes from `activity`, not `projects.updated_at`.** The
  project row moves only when the row itself changes, so a project with a week of
  task activity and no settings edit would look untouched.
- **A cancelled dependency still blocks.** That matches `isReady` in
  `task-lifecycle.ts`, which requires every dependency to be `done` and nothing
  else. Any other rule here would put a number on the card that the board's own
  `ready` flag contradicts.
