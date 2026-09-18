---
id: LAI-133
title: SPEC §6.4 should carry the enriched projects list shape
area: docs
assignee: chief
priority: p3
depends-on: [LAI-053]
discovered-from: LAI-053
status: done
started: 2026-09-03T05:15:00Z
finished: 2026-09-03T05:30:00Z
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

---

## Done — CHIEF, 2026-09-03

**§6.4 now carries the five fields §4.3 does not store**, in LAI-129's shape:
say what is *not* in §4 and point at what is, rather than duplicating a list that
two guarded artefacts already hold.

| | |
| --- | --- |
| `task_counts` | **every status present, zero included** — a caller must not have to tell *"no tasks in review"* from *"the server did not say"* |
| `blocked_count` | **`blocked_by` only**, never what a task blocks |
| `member_count` | |
| `members` | **first five by name**, `user_id` and `name` only — a row of avatars, deliberately not a member list |
| `last_activity_at` | **null means no activity, not none visible to you** |

**Each checked against `services/projects.ts`, not against this task file.**
`AVATAR_LIMIT = 5`, the counts are grouped with no filter, `last_activity_at` is
*"null if nothing has happened"*. **The task file described the shape correctly
and I opened the service anyway** — which is the only reason the next paragraph
exists.

### Two comments in that service say more than the code does

```ts
/** Live tasks by §4.5 status. … */
/** Tasks with at least one dependency that is not `done` (§4.5, derived). */
```

**§4.5 is `tasks`; §4.6 is `task_dependencies`.** And **`Live` describes a filter
that does not exist** — the query counts every task in the project, `done` and
`cancelled` included.

**`Live` is the more dangerous**, because it reads as a deliberate choice: someone
deciding whether to add a *"tasks remaining"* figure would take it as
already-filtered. **`LAI-469`**, p3, with a sweep of the rest of
`server/src/services/` attached.

**This is the third file this week where a factual claim in a comment was wrong
and the code was right.** The rule is in `CONVENTIONS.md` §4; what keeps finding
them is opening the artefact rather than the description of it.
