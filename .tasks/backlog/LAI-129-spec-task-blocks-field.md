---
id: LAI-129
title: SPEC §4.5 and §6.4 should carry the task's reverse dependency direction
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-091]
discovered-from: LAI-091
status: backlog
---

## Goal

LAI-091 AC5 asks for §4.5 and §6.4 (D-011). **`docs/` is CHIEF's**, so it travels.

`TaskView` now returns both directions of §4.6:

| field | meaning |
| --- | --- |
| `dependencies` | ids this task is **blocked by** — the forward edge |
| `blocks` | ids this task **blocks** — the reverse edge, read through §4.13's `task_dependencies(depends_on_task_id)` index |

## Acceptance criteria

- [ ] §6.4's task shape lists `blocks` beside `dependencies`.
- [ ] §4.5 states that **readiness depends only on what blocks a task**, never on
      what it blocks. That is the rule the new field makes easy to get wrong, and
      the code has a test holding it.
- [ ] Note that the two are **deliberately separate lists**. Merged, a task
      blocking three others is indistinguishable from one blocked by three, which
      is worse than showing neither.

## Notes / context

**Worth deciding, and not mine to decide:** `dependencies` is a poor name now
that both directions exist — `blocked_by` would say what it means. I did not
rename it because it is the wire contract the web client already reads and a
rename is a breaking change that deserves its own task rather than riding along
with a new field.

If CHIEF wants the rename, it needs: the server field, `server/web/src/api/tasks.ts`'s
`Task` type (SHELL's, and already the subject of LAI-121 and LAI-126), and a
release note. If CHIEF does not, §6.4 should say plainly that `dependencies` means
blocked-by, because the name alone does not.
