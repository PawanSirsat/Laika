---
id: LAI-046
title: Projects cards can have their progress bar now — LAI-053 landed
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-053, LAI-076]
discovered-from: LAI-076
status: in-progress
started: 2026-08-25T07:40:00+05:30
---

## Goal

LAI-076 built the projects home **without** the progress bar, counts, blocked
count and last-activity, because `GET /projects` did not return them. That was
the right call and it was explicitly scoped.

**LAI-053 has landed.** `GET /api/v1/projects` now carries per-project
aggregates in four grouped queries for the whole page — so the card can be
completed without one request per project.

## Acceptance criteria

- [ ] **Segmented progress bar**, 6px, radius 4px, ground `var(--tub)` — done
      `var(--grn)`, review `var(--amb)`, in-progress `var(--acc)`.
- [ ] Counts in mono beneath it (`13/34 done · 9 active`), from the response.
- [ ] **Blocked count in `var(--red)` with a padlock, only when non-zero.**
      It counts **tasks, not edges** — one task blocked by three things is one
      blocked task. Do not re-derive it.
- [ ] **Last activity, right-aligned in mono.** It comes from `activity`, not
      `projects.updated_at` — a project with a week of task activity and no
      settings edit is *not* untouched, and the field already reflects that.
- [ ] **Avatar stack** — 22px, `-6px` overlap, 1.5px `var(--page)` ring, colours
      from `theme/avatar-color.ts`. The API sends `user_id` and `name` only, by
      design: **there is no email to render and none should be requested.**
- [ ] A tombstone still renders as a removal, never as a card with blank counts
      (LAI-058's rule — the aggregates skip tombstones deliberately).
- [ ] Both themes, through the real theme control.

## Explicitly still out

**The live-agent pill.** LAI-053 omits it rather than sending it empty — the
write path is M4 (D-023), and an always-absent field reads as "no agents" rather
than "not built". Leave the space; do not draw a zero.

## Notes / context

Update `docs/design/GAPS.md`'s Projects row when this lands — it currently says
the counts are unbacked, and that will stop being true.
