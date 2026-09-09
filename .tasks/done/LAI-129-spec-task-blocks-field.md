---
id: LAI-129
title: SPEC §4.5 and §6.4 should carry the task's reverse dependency direction
area: docs
assignee: chief
priority: p3
depends-on: [LAI-091]
discovered-from: LAI-091
status: done
started: 2026-09-03T01:05:00Z
finished: 2026-09-03T01:15:00Z
---

## Goal

LAI-091 AC5 asks for §4.5 and §6.4 (D-011). **`docs/` is CHIEF's**, so it travels.

`TaskView` now returns both directions of §4.6:

| field | meaning |
| --- | --- |
| `dependencies` | ids this task is **blocked by** — the forward edge |
| `blocks` | ids this task **blocks** — the reverse edge, read through §4.13's `task_dependencies(depends_on_task_id)` index |

## Acceptance criteria

- [x] §6.4 lists `blocked_by` and `blocks` together — **not `dependencies`**,
      which D-044 renamed after this task was written.
- [x] §4.5 states that **readiness depends only on what blocks a task**, never on
      what it blocks. That is the rule the new field makes easy to get wrong, and
      the code has a test holding it.
- [x] Noted, in §4.5. **Deliberately separate lists** — merged, a task
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

---

## Done — CHIEF, 2026-09-03. **Two criteria had landed under D-044; the third became something better.**

§4.5 already carried both directions and the readiness rule — **D-044 wrote them
while renaming `dependencies` to `blocked_by`**, so this task's own AC1 names a
field that no longer exists. **Checked against §4.5 rather than against the task
file**, which is the rule that keeps costing us when it is skipped.

### §6.4 did not want a task shape, it wanted the six fields that are not in §4

**A full `TaskView` listing in §6.4 would be a third place for the same fields to
drift** — §4.5 has the columns, `tasks.ts` has the type, and a prose copy has no
guard. So §6.4 now lists **only what §4 does not have**, which is the thing a
reader actually cannot find:

| | |
| --- | --- |
| `key` | `project.key` + `number` |
| `tags` | `task_tags`, the whole set |
| `comment_count` | `comments`, excluding soft-deleted |
| `created_by_client` | the token's name (LAI-093) |
| `blocked_by`, `blocks` | both directions of §4.6 |

**Measured, not guessed**: `TaskView`'s fields minus the names §4.5 mentions,
leaving these six plus `created_at`/`updated_at`, which are on every view.

**This is the shape a documentation section should have when a guarded artefact
already carries the rest** — say what is *not* there, and point at what is.
