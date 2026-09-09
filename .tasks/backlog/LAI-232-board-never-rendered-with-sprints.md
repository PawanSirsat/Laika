---
id: LAI-232
title: The Board has never been rendered against a project with sprints
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-420
status: backlog
---

## Goal

**The symptom:** on a project that has sprints, the sprint strip renders **above
the `Board` header** instead of below it. Found by running the app against a
seeded local instance, not by a test.

**The finding is larger than the symptom.** That strip only appears once a
project has sprints — and **no fixture in the suite gives the Board a project
with sprints**. So this is not a missing assertion about layout. It is a
**branch of the main screen that has never been rendered anywhere**, in any test,
at any point.

Everything inside `{sprints.length > 0 && …}` on the Board is in that branch.
The misplaced strip is the one defect that happened to be visible in a
screenshot; nothing says it is the only one.

## Why this is worth more than moving a div

A layout fix takes a line. **The fixture gap is what let a visible defect reach
the screen the owner opens first**, and it will do it again for the next thing
added to that branch — the WIP badges, the sprint picker, anything sprint-shaped.

`test/browser/capacity.test.ts` and `board-presence.test.ts` both stub
`/projects/:slug/sprints` as `{ data: [] }`. That is the state under test
everywhere.

## Acceptance criteria

- [ ] A Board browser fixture with **a real sprint list** — at least one sprint
      containing today, per `docs/CONVENTIONS.md` §4: **anchored to today, never
      a calendar date** (LAI-420's six-day shelf life is the reason that rule
      exists).
- [ ] The strip renders **below** the `ScreenHeader`, asserted by geometry —
      its box begins after the header's ends. Not by class order in the source:
      that is what a reader sees, and the source order is already "correct".
- [ ] **Everything else in that branch is looked at once**, in both themes, and
      whatever else is wrong there is fixed or filed. Say in the log what was
      found, including "nothing else".
- [ ] Full gate green.

## Notes

**Do not fix the strip and stop.** The task exists because the branch was
unrendered; a fix that leaves it unrendered in tests has addressed the symptom
and left the cause.

The local instance the owner ran is seeded with three sprints on `laika-core` —
one finished, one running, one planned — if a live example is useful.
