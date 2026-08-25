---
id: LAI-211
title: Contract test for countSprints, the shell's cross-ownership dependency
area: web
assignee: builder-b
priority: p2
depends-on: []
discovered-from: LAI-064
status: in-progress
started: 2026-08-25T07:51:38Z
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

- [ ] A test in Builder-B's area asserts the contract the shell depends on:
      `countSprints(slug, signal?, maxPages?)` returns a `number`, counts across
      **every** page rather than the first, and does not filter by status.
- [ ] It fails if the signature or the paging behaviour changes — break each on
      purpose and watch it go red.
- [ ] It names D-030 and says why it lives in Builder-B's tests despite testing
      Builder-A's module, so nobody "tidies" it into their folder.

## Notes / context

`test/api/sprints.test.ts` already covers the paging behaviour, but it was
written as Builder-B's test of Builder-B's module. Under D-029 that file is
about someone else's code now — the ownership comment is the point, not new
coverage. Check what is already there before writing more.

**Do not move or edit `api/sprints.ts`.** If the contract needs to change, that
is a conversation with Builder-A, not an edit.
