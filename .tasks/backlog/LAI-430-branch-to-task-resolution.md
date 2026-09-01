---
id: LAI-430
title: 'A heartbeat''s branch resolves to a task (§9.2)'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-417, LAI-144]
discovered-from:
status: backlog
---

## Goal

§9.2: the convention is **`lai-<number>-<slug>`**, the server matches
`[a-z]+-(\d+)` case-insensitively against project prefixes, resolves the task,
and stores **`matched_task_id` on the heartbeat** and **`branch` on the task**.

`branchProjectPrefix` already exists — LAI-116 uses it to narrow a repo that
matches several projects. **It extracts the prefix and stops.** Nothing resolves
the number to a task, nothing writes either column, and `heartbeats.matched_task_id`
is nullable and always null.

## Acceptance criteria

- [ ] A heartbeat whose branch is `lai-42-add-crud`, on a repo resolving to the
      project with prefix `LAI`, stores that task's id in `matched_task_id`.
- [ ] The task's `branch` column is updated to the branch string.
- [ ] **Case-insensitive**, per §9.2, and matching `LAI-42-x`, `lai-42-x` and
      `Lai-42-X` alike. Reuse `branchProjectPrefix`'s pattern rather than writing
      a second one — LAI-144's lesson is that two implementations of one rule is
      one implementation and one bug.
- [ ] **Everything unresolvable degrades and never errors** (§9.2): no prefix
      match, a number no task has, a prefix belonging to a project the repo does
      not resolve to, a branch that is not the convention at all. Each is a
      separate test and each leaves `matched_task_id` null.
- [ ] **A repo resolving to several projects is decided before the number is.**
      §9.1 says an ambiguous repo narrowed by branch prefix picks one project;
      a branch that names a prefix **no** matching project has resolves to
      nothing rather than to a same-numbered task in a different project.
      **That is the one that corrupts data if it is wrong** — `LAI-42` and
      `WEB-42` are different tasks.
- [ ] A test that the resolution is **not** attempted when the org has
      `presence_enabled = 0`, once that column exists (LAI-207). If it does not
      exist yet, say so in the task rather than adding it here.

## Notes / context

**Do not store the resolution on anything else.** §9.3 is explicit that presence
and capacity attribute at request time and *"nothing is stored on the heartbeat"*
— `matched_task_id` is the exception §9.2 names, and it is the only one.

`tasks.branch` is a **last-seen**, not a history. Overwriting is correct; the
history is `activity`.

**Retention (§11.6) is LAI-431**, not this task.
