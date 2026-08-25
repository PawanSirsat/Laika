---
id: LAI-122
title: The sidebar sprint count goes stale the moment a screen changes the data
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-083]
discovered-from: LAI-083
status: in-progress
started: 2026-08-25T03:18:10Z
---

## Goal

`useShellContext` fetches `countSprints` once when the shell mounts and never
again. Delete a sprint on `/sprints` and **the badge keeps the old number** until
a full page reload.

Reproduced against the built app: two sprints, badge reads `2`, delete one, the
list correctly shows one sprint and the badge still reads `2`.

This is the exact failure D-028 exists to correct, one layer over: *"every number
comes from an API"* is necessary but not sufficient — a number that **came** from
the API and has since stopped being true is as wrong as a fixture, and harder to
spot because it was right a moment ago.

It will not stay a sprints problem. Every count the shell grows — open tasks,
review queue — has the same shape the first time a screen mutates it.

## Acceptance criteria

- [ ] A mutation on a screen updates any shell number derived from the same data,
      without a page reload.
- [ ] The fix is **not** a poll. LAI-049 already refused a timer nobody
      remembers to remove, and the shell is the worst place for one.
- [ ] Assert it: change the underlying data and check the rendered count, rather
      than checking that a refetch function exists.

## Notes / context

Three approaches, in the order I would try them:

1. **Refetch on route change.** Smallest, and wrong in the case that matters —
   deleting a sprint does not change the route, so the badge stays stale on the
   screen the reader is looking at.
2. **An invalidation signal the shell subscribes to** — a counter a screen bumps
   after a mutation. Small, explicit, and no library. My `use-sprints.ts` already
   has the seam: every mutation ends in one `setAttempt(n => n + 1)`.
3. **SSE (LAI-048/LAI-070).** The real answer, and it makes this whole class of
   bug disappear rather than patching one instance. The server has streamed
   activity since LAI-048 and nothing consumes it. If LAI-070 is close, this
   task may be better spent there than on a bespoke signal.

**`use-shell-context.ts` and `AppShell.tsx` are Builder-B's** under D-028, which
is why this is a task rather than a fix — I could not have done it from
`routes/screens/sprints/` even if the right answer were obvious.
