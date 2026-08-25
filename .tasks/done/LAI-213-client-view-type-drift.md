---
id: LAI-213
title: Nothing catches the web client's types falling behind the server's view types
area: web
assignee: builder-b
priority: p2
depends-on: []
discovered-from: LAI-046
status: done
started: 2026-08-25T08:32:11Z
finished: 2026-08-25T09:01:42Z
reviewed: 2026-08-26T12:00:00+05:30
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

- [x] A test fails when a server view type has a field the matching client
      interface does not declare. Start with the pairs that have already
      drifted: `TaskView`↔`Task`, `ProjectView`↔`Project`, `SprintView`↔`Sprint`,
      `MemberView`↔`Member`, `UserView`↔`OrgUser`, `CommentView`↔`Comment`,
      `EventView`↔`ActivityEvent`.
- [x] **Extra fields on the client are also a failure** — they mean the client
      expects something the server never sends, which fails at runtime rather
      than at build.
- [x] A pair can be exempted **with a written reason**, the same shape as
      `WEB_NO_MIRROR_REQUIRED`. Deliberate omissions are fine; silent ones are
      not.
- [x] **Re-introduce one of the four historical drifts and watch it go red**
      before trusting it.

## Notes / context

Parsing TypeScript interfaces textually is enough — both sides are plain
`readonly name: type;` declarations, and the existing structural tests already
read source this way (`structure.test.ts`, `use-events.test.ts` reading
`ACTIVITY_TYPES`). **Do not add a dependency for this.**

Where the names differ deliberately (`UserView`→`OrgUser`), the pair list is the
place to say so.

---

## It found six live drifts on its first run (builder-b, 2026-08-25T09:01:42Z)

Not a guard waiting for a future mistake — the codebase was already wrong in six
places when it landed:

```
TaskView.acceptance_md    served, undeclared
TaskView.blocks           served, undeclared
TaskView.comment_count    served, undeclared   (LAI-072 added it; nothing saw it)
SprintView.project_id     served, undeclared
SprintView.created_at     served, undeclared
SprintView.updated_at     served, undeclared
```

All six confirmed against the running instance before being declared — the
sprint payload really does carry `project_id`, `created_at`, `updated_at`, and
the task payload really does carry the other three. They are now declared, which
is the fix; **rendering** `comment_count` remains LAI-223's.

That makes **eight** instances of this defect, counting the four in the table
above plus `Task.tags` and `Task.comment_count`, which I hit while building
LAI-066 this morning.

## The thing that would have made it cry wolf

`ProjectSummary extends ProjectView` on the server, and the client's `Project` is
flat. Comparing `ProjectSummary`'s own body alone reports its five inherited
fields as missing, so **the parser resolves `extends`** — without that, the guard
fails on arrival for a reason that is not a defect, and the natural response to a
guard that cries wolf is to delete it.

Found by running the comparison before writing the test, rather than after.

## Both directions, and why the second one matters more

A missing client field is invisible: the data arrives and nothing shows it.
A **surplus** client field is worse — the type promises something the server
never sends, so it is `undefined` at runtime on a shape TypeScript asserted
rather than checked. Both fail here.

## Proven able to fail, four ways

| Mutation | Result |
| --- | --- |
| remove `Task.sprint_id` — the real LAI-011→LAI-089 drift | fails, naming the field |
| remove `Project.repo` — the real LAI-108→LAI-076 drift | fails, naming the field |
| add a client field the server never sends | fails on the other direction |
| rename a server view type in the pair list | fails **loudly**, rather than comparing an empty set and passing |

The last one is the guard guarding itself: a pair that silently stopped matching
would leave its types unwatched for ever, which is exactly the shape of the
`not-in-bundle.test.ts` near-miss.

## Scope

`TaskFilter.sprint` from the task's table is a **query parameter**, not a view
type, so it is outside what this compares. Query-string drift is a real cousin of
this defect and would need its own guard; not filed, because I have no second
instance of it.

## Review — PM, 2026-08-26

**Accepted. I probed it in both directions and both bite:**

```
server gains a field  → TaskView.brand_new_field is served and Task does not
                        declare it — add it, or list it in clientOmits with a reason
client drops a field  → TaskView.sprint_id is served and Task does not declare it …
```

The message **names the field and offers the escape hatch in the same sentence**,
which is what makes a drift failure actionable rather than a puzzle.

**This closes the fourth axis.** The chain now runs unbroken:

```
SPEC §4  ↔  schema.ts  ↔  migrations  ↔  database        (LAI-051, LAI-061)
SPEC §3  ↔  can()                                        (LAI-100)
server views  ↔  client types                            (this)
```

**LAI-121 was one instance of what this class catches** — `sprint_id` on
`TaskView` since LAI-011, absent from the client type, invisible for four tasks
because the only screen reading tasks did not group by sprint. A field can be
served and unreachable for weeks, and nothing but a mechanical comparison finds
it.

**`clientOmits` with a required reason** is the right shape: the client
legitimately does not need everything the server sends, and an omission with a
stated reason is a decision while a silent one is a bug waiting.
