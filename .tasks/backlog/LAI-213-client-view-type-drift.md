---
id: LAI-213
title: Nothing catches the web client's types falling behind the server's view types
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-046
status: backlog
---

## Goal

**Four times now, the server has sent a field the client could not see.** Each
was found by accident, while building something else:

| field | served since | found in | cost |
| --- | --- | --- | --- |
| `Task.sprint_id` | LAI-011 | LAI-089 | no sprint tag on cards; Builder-A carried a local re-declaration |
| `TaskFilter.sprint` | LAI-011 | LAI-089 | the board could not scope to a sprint |
| `Project.repo` | LAI-108 | LAI-076 | no screen could show a project's repository |
| `Project.task_counts`, `blocked_count`, `member_count`, `members`, `last_activity_at` | LAI-053 | LAI-046 | the whole card was built without them |

**Nothing failed in any of these cases.** No error, no test, no type
complaint — the data arrived and was invisible. That is the worst shape of
defect we have: it looks exactly like the feature not existing.

This is **not** covered by the existing drift checks. `LAI-051` and `LAI-080`
compare SPEC §4 to `schema.ts`; `LAI-211` pins one function's contract. Nothing
compares **`server/src/services/*.ts` view types** to **`server/web/src/api/*.ts`
declarations**.

## Acceptance criteria

- [ ] A test fails when a server view type has a field the matching client
      interface does not declare. Start with the pairs that have already
      drifted: `TaskView`↔`Task`, `ProjectView`↔`Project`, `SprintView`↔`Sprint`,
      `MemberView`↔`Member`, `UserView`↔`OrgUser`, `CommentView`↔`Comment`,
      `EventView`↔`ActivityEvent`.
- [ ] **Extra fields on the client are also a failure** — they mean the client
      expects something the server never sends, which fails at runtime rather
      than at build.
- [ ] A pair can be exempted **with a written reason**, the same shape as
      `WEB_NO_MIRROR_REQUIRED`. Deliberate omissions are fine; silent ones are
      not.
- [ ] **Re-introduce one of the four historical drifts and watch it go red**
      before trusting it.

## Notes / context

Parsing TypeScript interfaces textually is enough — both sides are plain
`readonly name: type;` declarations, and the existing structural tests already
read source this way (`structure.test.ts`, `use-events.test.ts` reading
`ACTIVITY_TYPES`). **Do not add a dependency for this.**

Where the names differ deliberately (`UserView`→`OrgUser`), the pair list is the
place to say so.
