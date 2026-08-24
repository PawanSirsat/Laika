---
id: LAI-046
title: Projects cards can have their progress bar now — LAI-053 landed
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-053, LAI-076]
discovered-from: LAI-076
status: review
started: 2026-08-25T07:40:00+05:30
finished: 2026-08-25T08:05:00+05:30
---

## Goal

LAI-076 built the projects home **without** the progress bar, counts, blocked
count and last-activity, because `GET /projects` did not return them. That was
the right call and it was explicitly scoped.

**LAI-053 has landed.** `GET /api/v1/projects` now carries per-project
aggregates in four grouped queries for the whole page — so the card can be
completed without one request per project.

## Acceptance criteria

- [x] **Segmented progress bar**, 6px, radius 4px, ground `var(--tub)` — done
      `var(--grn)`, review `var(--amb)`, in-progress `var(--acc)`.
- [x] Counts in mono beneath it (`13/34 done · 9 active`), from the response.
- [x] **Blocked count in `var(--red)` with a padlock, only when non-zero.**
      It counts **tasks, not edges** — one task blocked by three things is one
      blocked task. Do not re-derive it.
- [x] **Last activity, right-aligned in mono.** It comes from `activity`, not
      `projects.updated_at` — a project with a week of task activity and no
      settings edit is *not* untouched, and the field already reflects that.
- [x] **Avatar stack** — 22px, `-6px` overlap, 1.5px `var(--page)` ring, colours
      from `theme/avatar-color.ts`. The API sends `user_id` and `name` only, by
      design: **there is no email to render and none should be requested.**
- [x] A tombstone still renders as a removal, never as a card with blank counts
      (LAI-058's rule — the aggregates skip tombstones deliberately).
- [x] Both themes, through the real theme control.

## Explicitly still out

**The live-agent pill.** LAI-053 omits it rather than sending it empty — the
write path is M4 (D-023), and an always-absent field reads as "no agents" rather
than "not built". Leave the space; do not draw a zero.

## Notes / context

Update `docs/design/GAPS.md`'s Projects row when this lands — it currently says
the counts are unbacked, and that will stop being true.

## Notes at review — builder-b

### Measured against the criteria, both themes

| | asked | measured |
| --- | --- | --- |
| bar | 6px, ground `--tub` | `6px`, `rgb(231,233,241)` / `rgb(20,20,24)` |
| done / review / active | `--grn` / `--amb` / `--acc` | all three, inverting correctly |
| blocked | `--red`, padlock, only when non-zero | `rgb(217,58,69)` / `rgb(244,99,109)`, `1 blocked` |
| counts | mono | JetBrains Mono |
| faces | 22px, `-6px` overlap, page ring | `22px`, `-6px` |

`Laika Docs` has no tasks, so it renders **no bar at all** rather than an empty
one — a 0-length bar reads as "nothing done" when the truth is "nothing to do".

### Nothing is re-derived

`task_counts`, `blocked_count` and `last_activity_at` are rendered exactly as
served. In particular **`blocked_count` is not recomputed** — it counts tasks
rather than dependency edges, and the board already has a client-side
`blockedState` helper that counts differently and only over *loaded* tasks.
Deriving it here would have produced a number that quietly disagreed with the
server on the same screen.

`last_activity_at` is used rather than `updated_at`, so a project with a week of
task activity and no settings edit reads as active.

### The avatar-stack question from LAI-076 is answered

I left the stack out of LAI-076 because the AC sourced identities from
`GET /users`, which is org-wide — a stack built from it shows the same faces on
every card — and real membership was one request per card. **LAI-053 settles it
properly**: the project list now carries `members: [{ user_id, name }]` per
project, so the faces are the project's, in one request. No email is sent and
none is asked for.

### Fourth client type found behind the server payload

`Project` was missing `task_counts`, `blocked_count`, `member_count`, `members`
and `last_activity_at` — declared here. That follows `Task.sprint_id`,
`TaskFilter.sprint` and `Project.repo`.

**Four now.** Every one was a field the server sent and the client could not
see, and in each case nothing failed — the data was simply invisible. A test
diffing the declared client shapes against the server's view types would have
caught all four. I have not built it because it is not this task; **it is worth
filing.**

### Still out, deliberately

The live-agent pill. LAI-053 omits it rather than sending it empty, and an
always-absent field reads as "no agents" rather than "not built" (D-023, M4).
