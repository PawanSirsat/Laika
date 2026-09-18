---
id: LAI-469
title: '`ProjectSummary`''s comments say `§4.5` for dependencies and `Live` for an unfiltered count'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-133
status: backlog
---

## Goal

Two comments in `server/src/services/projects.ts` say more than the code does.
**Found while writing §6.4's projects-list shape and checking each field against
the service rather than against the task file that described it.**

```ts
/** Live tasks by §4.5 status. Every status is present, zero included. */
task_counts: Record<TaskStatus, number>;
/** Tasks with at least one dependency that is not `done` (§4.5, derived). */
blocked_count: number;
```

1. **`§4.5` is wrong for dependencies.** §4.5 is `tasks`; **§4.6 is
   `task_dependencies`**, which is what `blocked_count` reads.
2. **`Live` describes a filter that does not exist.** The query is
   `.where(inArray(tasks.projectId, ids)).groupBy(...)` — **every task in the
   project, including `done` and `cancelled`.** The rest of that sentence is
   exactly right, which is what makes the first word easy to miss.

## Why it is worth a task rather than a shrug

**Neither is a bug and both are the class this repo keeps paying for.** LAI-462
found seven wrong facts in one docblock family, two of them **section numbers,
swapped and both wrong**, in a comment explaining a fix for a bug caused by not
checking a section. `CONVENTIONS.md` §4 now carries the rule; this is the same
shape in a different file.

**`Live` is the more dangerous of the two**, because it reads as a deliberate
choice. A reader deciding whether to add a *"tasks remaining"* figure would take
it as already-filtered and be wrong.

## Acceptance criteria

- [ ] `§4.5` → `§4.6` for `blocked_count`, **verified by opening §4.6** rather
      than by trusting this task file.
- [ ] `Live` either goes, or becomes true. **Going is almost certainly right** —
      §6.4 now documents the field as *"tasks by §4.5 status, every status
      present and zero included"*, and that is what the query does.
- [ ] **Sweep `server/src/services/` for other `§4.N` references and check each
      against the heading it names.** One `grep -n '^### 4\.'` gives the map.
      **Report the count you checked and the count that were wrong, including
      zero.**

## Notes / context

**Do not add a guard.** A test asserting that comments cite the right section
would be parsing prose to check prose. `CONVENTIONS.md`'s rule is the control, and
a sweep is the instrument.
