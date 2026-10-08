---
id: LAI-728
title: 'Capacity sends each task’s key, title and priority beside its id'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-724]
discovered-from: LAI-724
status: backlog
---

## Goal

`GET /capacity` names tasks by id only (`in_progress_tasks`, `tasks_in_review`),
and the Capacity screen draws each as key, title and priority. LAI-724 resolves
the ids from the open project's task set, which covers a single-project org
completely. Capacity is org-wide, though, so a task in **another** project is
genuinely missing from that set, and the screen still makes one
`GET /tasks/:id` for each such task, once per visit. Send what the screen draws
beside each id, and those requests go too.

## Acceptance criteria

- [ ] Each task reference in the capacity view carries `id`, `key`, `title` and
      `priority`, filtered by the same `can()` rule that already decides which
      ids a reader sees (a reader is not told the title of a task they cannot
      read).
- [ ] SPEC §6.4's capacity shape documents it, and the parity and drift tests
      agree.
- [ ] `CapacityScreen.tsx` makes no `GET /tasks/:id`, and its fallback in
      `elsewhere` is removed.

## Notes / context

- Found while building LAI-724 (performance phase 2). Measured there: with one
  project, Capacity's cold load dropped from 149 requests to the number
  recorded in `logs/perf-2026-10-08.md`. With several projects, the remaining
  per-task reads are one for each in-progress or in-review task outside the open
  project.
- Changing the shape of `in_progress_tasks` breaks clients that read ids. A new
  field beside the id arrays is the compatible form.
