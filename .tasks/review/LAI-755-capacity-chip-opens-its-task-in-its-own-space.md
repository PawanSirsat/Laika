---
id: LAI-755
title: 'A Capacity chip opens its task in the task’s own space, not the last space opened'
area: web
assignee: owner-direct
priority: p2
depends-on: [LAI-754]
discovered-from: LAI-754
status: review
finished: 2026-10-17T07:17:36Z
started: 2026-10-17T06:49:03Z
---

## Goal

Clicking an in-progress chip on Capacity opens that task. Today it navigates to
`/board?q=<KEY>` with no `?project=`, so the board falls back to whichever space
was open last and searches it for a key that may belong to another space. Now
that Capacity is one page across every space (LAI-754), a chip from another
space is the common case, and the click lands on an empty board.

Measured on a local instance while building LAI-754 (three spaces, port 3754):
clicking `LC-1` landed on `/board?q=LC-1&project=laika-core` and showed the
task; clicking `LW-1` landed on `/board?q=LW-1&project=laika-core` — Laika
Core's board, no cards — although LW-1 is in Laika Web.

## Acceptance criteria

- [x] A chip opens `/board?project=<the task's own space>` with the task open
      (the board opens a task by id in `?task=`, LAI-424), for a task in any
      space the reader can see.
- [x] A browser test clicks a chip for a task in a space other than the last
      one opened and asserts the space and the open task; shown red against
      the current `openTaskByKey`.

## Notes / context

- **Claimed with LAI-755, LAI-756, LAI-730, LAI-744 and LAI-759 together:
  cleanup release, owner's direct instruction** (docs/HANDOVER.md §4), one
  builder on branch `build-cleanup`.
- Pre-existing: the Capacity tab used the same `openTaskByKey` before LAI-754;
  LAI-754 kept it unchanged to keep scope tight.
- The screen already reads `GET /projects` (for the "across N spaces" count),
  so the task's `project_id` → slug is available without a new request.
- `server/web/src/components/shell/ScreenOutlet.tsx` (`openTaskByKey`,
  `CapacityRoute`) and `server/web/src/routes/screens/capacity/CapacityScreen.tsx`.
- Unlisted work's *Open LAI-7* link after a promote uses the same helper and
  has the same shape of problem when the promoted task's space is not the last
  one opened.

## Result

- **`982bb11b`** `fix(web): a Capacity chip opens its task in the task's own space`.
- `CapacityScreen.tsx` keeps the `GET /projects` list as slug by project id
  and hands the route the chip's `{ id, key, projectSlug }`;
  `ScreenOutlet.tsx`'s new `openTaskInItsSpace` opens
  `/board?project=<slug>&task=<id>`. A key search stays the fallback only when
  the space list could not be read.
- Test: `test/browser/capacity.test.ts`, *"a chip opens its task in the task's
  own space, not the last one opened (LAI-755)"* — opens Laika Core's board
  first, goes to Capacity, clicks `LW-1` (Laika Web), asserts
  `project=laika-web`, `task=t9` and the drawer showing LW-1. **Red against the
  old `openTaskByKey`**: `expected 'laika-web', actual 'laika-core'`.
- Screenshots: `/tmp/laika-cleanup-shots/{before,after}-capacity-chip-*.png`
  (before lands on `/board?q=LW-1&project=laika-core`, an empty board; after on
  `/board?project=laika-web&task=t9` with the task open).
- Not changed: Unlisted work's *Open LAI-7* link and Meeting review still use
  `openTaskByKey` (the Notes' last bullet). Out of this task's criteria.
