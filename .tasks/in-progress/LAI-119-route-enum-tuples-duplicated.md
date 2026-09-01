---
id: LAI-119
title: Route files retype the closed vocabularies instead of reaching for them
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-071
status: backlog
---

## Goal

`db/enums.ts` exists so a closed vocabulary is declared **once**: its comment says
"Declaring them once is what stops the three from drifting apart" — the TypeScript
union, the SQL `CHECK`, and the runtime list.

Two route files quietly make a fourth copy:

- `src/http/routes/tasks.ts:27-28` — `STATUSES` and `PRIORITIES` retyped by hand;
- `src/http/routes/sprints.ts` — `STATUSES` again;
- `src/http/routes/tasks.ts:37` — `created_via` inline, a fifth.

They do it for a good reason: CONVENTIONS §2 forbids `http/routes/` importing
`db/`, and the tuples are values, so `allowTypeImports` does not help.

**Nothing checks the copies against the source.** Add a status to `db/enums.ts`
and `tasks.ts` will 422 a value the database happily stores; delete one and the
route accepts a value the `CHECK` constraint refuses at write time, turning a
clean 422 into a 500. Neither drift direction has a test.

LAI-071 hit the same wall and took the other route: `services/invites.ts`
re-exports `ORG_ROLES` and `PROJECT_ROLES`, so `routes/invites.ts` reaches them
through the service layer it is already allowed to import. One declaration, no
new lint exception, no ban on barrels tripped (the file is full of real code).

That leaves the codebase with two idioms for one problem, which is worth closing
in whichever direction is judged right.

## Acceptance criteria

- [ ] One idiom for every route that needs a vocabulary. If the re-export is the
      chosen one, `tasks.ts` and `sprints.ts` adopt it; if the hand-typed tuple is,
      `invites.ts` gives up its re-export and this task says why the drift risk is
      acceptable.
- [ ] `created_via` in `tasks.ts:37` is included — an inline literal is the same
      duplication with less to grep for.
- [ ] A test that fails when a route's accepted set and `db/enums.ts` disagree,
      **in both directions**. Without it this converges once and drifts again; the
      re-export only removes the risk for the files that use it.
- [ ] Proved by breaking it: add a member to a vocabulary in `db/enums.ts` alone
      and confirm the test goes red.

## Notes / context

No behaviour changes. Every current copy happens to match its source — this is
about the guarantee, not a live bug.

Worth checking whether the same test can cover the **MCP** layer when it lands
(§7): `mcp/` may not import `db/` either, so it will meet this exact wall, and
deciding once is cheaper than a third idiom.
