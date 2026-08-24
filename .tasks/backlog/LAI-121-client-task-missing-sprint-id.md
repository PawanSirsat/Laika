---
id: LAI-121
title: The client Task type is missing sprint_id, which the API returns
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-083
status: backlog
---

## Goal

`server/src/services/tasks.ts` has put `sprint_id` on every `TaskView` since
LAI-011, and `GET /api/v1/projects/:slug/tasks` returns it on every row.
**`server/web/src/api/tasks.ts` never declared it.**

Nothing noticed because the board was the only screen reading tasks and the board
does not group by sprint. LAI-083 does, and had to declare the field locally in
`routes/screens/sprints/sprint-derive.ts` (`SprintTask`, `readSprintId`) because
`api/` is Builder-B's.

That local declaration is a checked read, not a cast — a server that stopped
sending the field degrades to "no sprint" rather than leaking `undefined` through
a type assertion — but it is still the field being declared in the wrong place.

## Acceptance criteria

- [ ] `Task` in `server/web/src/api/tasks.ts` gains
      `readonly sprint_id: string | null`, matching `TaskView`.
- [ ] `TaskFilter` gains `sprint?: string`, and `toQuery` passes it through.
      §6.4 documents `?sprint=` on the task list and the client cannot send it;
      `sprint=none` is the documented way to ask for unassigned work, the same
      convention `assignee=none` already uses.
- [ ] `sprint-derive.ts`'s `SprintTask`, `readSprintId` and `withSprintIds` are
      removed and their call sites use `Task` directly. Their tests go with them.
- [ ] A test that the client's `Task` fields are a subset of the server's
      `TaskView` — this drift was invisible for four tasks and will recur.

## Notes / context

**The last criterion is the one worth arguing about.** The first three are a
five-minute change; without the fourth the same gap reappears the next time the
server adds a field, and it will again be invisible until a screen needs it.
`test/api/sprints.test.ts` already reads `SPRINT_STATUSES` out of the server's
`enums.ts` to prove the vocabularies match — after somebody wrote `complete` for
`completed` from memory. The same trick works here: parse `TaskView` out of
`server/src/services/tasks.ts` and compare the field lists.

Related: LAI-119 is the same shape of problem one layer down — a closed
vocabulary declared in two places with nothing comparing them.
