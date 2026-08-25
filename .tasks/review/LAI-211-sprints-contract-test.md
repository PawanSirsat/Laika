---
id: LAI-211
title: Contract test for countSprints, the shell's cross-ownership dependency
area: web
assignee: builder-b
priority: p2
depends-on: []
discovered-from: LAI-064
status: review
started: 2026-08-25T07:51:38Z
finished: 2026-08-25T08:18:40Z
---

## Goal

**D-030**: a cross-ownership dependency is allowed, an unguarded one is not.

`api/use-shell-context.ts` imports `countSprints` from `api/sprints.ts` to put
the sprint count on the sidebar nav item. Under D-029 that module is
**Builder-A's** — they are adding create/update/activate/delete while the shell
needs one read function.

Nothing currently fails if they change its signature, its return type, or the
shape it expects back from the endpoint. The sidebar badge would simply stop
being right, and a wrong number is worse than no number.

## Acceptance criteria

- [x] A test in Builder-B's area asserts the contract the shell depends on:
      `countSprints(slug, signal?, maxPages?)` returns a `number`, counts across
      **every** page rather than the first, and does not filter by status.
- [x] It fails if the signature or the paging behaviour changes — break each on
      purpose and watch it go red.
- [x] It names D-030 and says why it lives in Builder-B's tests despite testing
      Builder-A's module, so nobody "tidies" it into their folder.
      **Met with a corrected reason — this task's premise expired. See below.**

## Notes / context

`test/api/sprints.test.ts` already covers the paging behaviour, but it was
written as Builder-B's test of Builder-B's module. Under D-029 that file is
about someone else's code now — the ownership comment is the point, not new
coverage. Check what is already there before writing more.

**Do not move or edit `api/sprints.ts`.** If the contract needs to change, that
is a conversation with Builder-A, not an edit.

---

## AC3's premise expired before I could write it (builder-b, 2026-08-25T08:18:40Z)

The criterion asks for a comment explaining *"why it lives in Builder-B's tests
despite testing Builder-A's module."* **That is no longer true.** This task was
written under **D-029**, which gave `api/sprints.ts` to Builder-A for the
duration of D-028. **D-031 retired D-028 and D-029, and D-030's specific
application to this file** — `api/sprints.ts` came back to Builder-B, and I have
been editing it freely today.

Writing that comment would have put a false statement in the one place whose
whole job is stopping someone act on a stale assumption.

**So the block names D-030 and gives the reason that is actually true.**
CLAUDE.md says *"D-030's general rule survives its example: a cross-ownership
dependency is allowed, an unguarded one is not. It applies wherever the
situation recurs."* It recurs here — the boundary just moved. `countSprints`
walks pages of an endpoint owned by **Builder-A** under D-016
(`server/src/http/routes/sprints.ts`), and the sidebar badge is the only reader
of the total. The contract worth pinning is between this client and the server's
paging, not between two web folders that now have one owner.

If PM would rather the criterion had been left unticked, say so and I will
unpick it — but a guard carrying a reason that is false on the day it lands
seemed worse than a guard carrying the reason that is true.

## What was already covered, and the gap that was not

The task's notes were right: `test/api/sprints.test.ts` already proves the
paging thoroughly — every page, empty project in one request, no status filter,
capped rather than looping. **AC1's substance was already met.**

What nothing guarded is the **link**. Rewrite `use-shell-context.ts` to take
`listSprints(...).data.length` and every one of those tests still passes, while
a project past its first page quietly shows a low number. A wrong number is
worse than no number — which is exactly why the badge renders nothing for
`undefined`.

## Proven able to fail, three ways

| Mutation | Result |
| --- | --- |
| the shell pages sprints itself, taking page one | **only the new link test fails** — the gap was real and unguarded |
| `countSprints` stops after the first page | the existing paging tests fail |
| `countSprints` returns `{ count }` instead of a number | the existing tests and the new type assertion fail |

The first row is the one that matters: it is the case that previously had no
witness at all.
