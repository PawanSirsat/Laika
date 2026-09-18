---
id: LAI-259
title: 'The space bar says "No space" for a project that exists'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-251
status: backlog
---

## Goal

**Found on a real instance, not in a test.** Signed in against a live server at
`/board?project=laika-infra`, the sidebar lists the space and the board renders
its tasks, and the space bar's headline reads **"No space"** — the most
prominent text on the screen, wrong, permanently.

`GET /projects/:slug` returned `200`. The failure is entirely client-side:

- `SpaceLayout` calls `toSpace(project)` on that response;
- `toSpace` → `spaceMeta` reads `project.task_counts` and `project.member_count`;
- **the single-project response carries neither.** They are derived fields the
  *list* endpoint adds (SPEC §6.4's read-shape note); the by-slug response is
  the plain §4.3 row;
- `Object.values(undefined)` throws, and the `.catch` beside the call — written
  for an unreachable instance — swallows it.

Verified against the running server:

```
GET /api/v1/projects/laika-infra  ->  200
  task_counts: absent   member_count: absent
```

Two defects, and the second is the reason the first survived review:

1. **A list-only helper used on a by-slug response.** `Project` is one client
   type for two different server shapes, so the compiler could not see it —
   the same family as LAI-226's hand-written `ProjectSummary`.
2. **An empty `catch` that swallowed a programming error.** It was written to
   tolerate an unreachable instance and silently absorbed a `TypeError`.

## Acceptance criteria

- [ ] The space bar shows the project's real name wherever a project is in the
      URL, including a project that is not on the first page of the list.
- [ ] The bar takes only what the by-slug response actually carries. No caller
      reads `task_counts` or `member_count` off it.
- [ ] **A browser test whose stub matches the real server** — a by-slug
      response *without* the list-only fields. The existing space-bar test
      passes today because its fixture carries them, which is what let this
      ship.
- [ ] The `catch` beside the fetch no longer hides a thrown error: a failure to
      *reach* the endpoint leaves the bar on its fallback, and a failure to
      *read* the response is not silently identical to it.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

Discovered from LAI-251, which is in `.tasks/review/` and not accepted; filed
as its own task rather than reopening submitted work (§2).

**The wider issue is worth its own task and is not this one**: `getProject` and
`listProjects` both claim to return `Project`, and only one of them sends the
derived five. That is LAI-226's shape seen from the other end — a client type
that is true of one endpoint and not the other, with no guard that can tell.
