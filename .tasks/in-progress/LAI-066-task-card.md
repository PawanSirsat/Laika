---
id: LAI-066
title: Task card anatomy — priority, key, sprint, dependencies, assignee
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-049, LAI-050, LAI-060, LAI-079]
discovered-from:
status: in-progress
started: 2026-08-25T03:51:56Z
---

## Goal

Bring `TaskCard` up to the prototype's card. **Scoped deliberately to what the
API returns** — I checked `TaskView` field by field before writing this.

## Acceptance criteria

- [ ] **Priority dot** from `priority`, using `--red` / `--amb` / `--tx3`.
- [ ] **Task key** in mono (`LAI-158`), from `key`.
- [ ] **Sprint chip** when `sprint_id` is set — resolve the name via the sprints
      endpoint (LAI-050); never render the raw id.
- [ ] **Dependency count** from `dependencies.length`.
- [ ] **Assignee avatar** from `assignee_id`, resolved through
      `GET /api/v1/users` (LAI-060), coloured by `theme/avatar-color.ts`.
- [ ] **Blocked treatment** when `ready` is false and dependencies are unmet —
      the prototype shows *"blocked by LAI-140 event store"*. Name the blocker;
      a bare "blocked" badge makes someone go hunting.
- [ ] Both themes.

## Explicitly NOT in this task

- ~~**Tag chips**~~ — **now in scope.** The owner decided tags are real
  (**D-027**, 2026-08-25) and **LAI-079** builds them, which is why this task now
  depends on it. Render the chips from `TaskView.tags`:
  neutral `--tub` ground, `--bd` border, `--tx2` text — **no per-tag colour**,
  which D-027 settled deliberately. A task may carry several; the design shows
  two on one card.
- **Comment count** (`💬 5`). Not on `TaskView`. Filed as **LAI-072**.

## Notes / context

Both exclusions are the §5.1 rule: a screen that needs data no endpoint returns
waits, it does not stub. The card is worth building now regardless — six of the
eight elements are backed by real fields today.
