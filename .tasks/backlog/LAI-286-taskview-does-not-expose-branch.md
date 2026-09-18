---
id: LAI-286
title: TaskView does not expose `tasks.branch`
area: server
assignee: unclaimed
status: backlog
priority: p3
depends-on: []
discovered-from: LAI-285
---

## What

`tasks.branch` is a real column — the plugin writes it when an agent starts work
— and `TaskView` does not include it. The browser therefore cannot show which
branch a task is being done on.

The imported design puts it on the task drawer's meta rail, under the space:

```
SPACE
laika-infra
branch lai-142-claim-lock
```

LAI-285 left that line **out** rather than inventing one: a branch name in front
of a reader that nothing verified is worse than an absent line.

## Why it is worth doing

It is the one thing on that rail that says *where the code is*. Presence carries
a `branch` per session, but that is where a person is working **now** — a
different fact from the branch this task belongs to, and they disagree as soon
as somebody switches.

## Acceptance criteria

- [ ] `TaskView` carries `branch: string | null`, from the column that exists.
- [ ] The client type mirrors it and `structure.test.ts`'s drift check is green.
- [ ] A test asserts a task with no branch serialises `null` rather than
      omitting the field — the client distinguishes "no branch" from "not sent".
