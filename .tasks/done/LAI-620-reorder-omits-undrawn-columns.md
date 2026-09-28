---
id: LAI-620
title: Dragging a column is refused whenever the board has one it cannot draw
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-617
status: done
finished: 2026-09-28T12:48:32Z
started: 2026-09-28T12:44:39Z
reviewed: 2026-09-28T17:49:35Z
---

## Goal

Reordering columns works on every board, not only on boards whose every column
is drawable. On the owner's live `onroute` board **every drag is refused** and
the lanes snap back, which is what they reported as *"the columns are not
shifting the sequence"*.

Measured against the live board rather than inferred:

```
POST /projects/onroute/board-columns/reorder  {"column_ids": [<the 4 drawn>...]}
-> 422 {"expected": 7, "received": 5}
```

## The defect

`reorderColumns` requires **every** column of the project exactly once. The
board draws `columns.visible`, which excludes columns for **two** reasons:

```ts
.filter((c) => !c.hidden && c.statuses.length > 0)
```

`BoardScreen`'s `onReorder` compensates for the first and not the second — it
appends `state.columns.filter((c) => c.hidden)`. A column that is neither
hidden nor drawable is in neither list, so the payload is short and the server
refuses. `onroute` has two such columns (`Backlogs`, `Testing`), so no drag on
that board has ever worked.

The comment above that line records the identical bug being fixed once already,
for `Cancelled`. **The list of exclusions grew (LAI-617) and the compensation
did not** — enumerating the exclusions is what made that possible.

## Acceptance criteria

- [x] `onReorder` sends the **complement** — every column not in the dragged
      order, appended in `position` order — rather than a list of the reasons a
      column might not be drawn.
- [x] A browser test drags a column on a board whose fixture contains a
      status-less column **and** a hidden one, and asserts the request body
      carries every column id exactly once.
- [x] That test fails against the pre-fix caller. A fixture without a
      status-less column cannot show this, which is why the fixture is named in
      this criterion.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Notes / context

- The server's check is right and stays. The caller was sending a subset.
- Sibling of LAI-618 (CORE's): that one stops the status-less state being
  *created*; this one stops it breaking an unrelated feature while it exists.

## Review — 2026-09-28T17:49:35Z (CHIEF)

**Accepted.** Merged as part of `shell` up to `df23d67`.

**Verified on a private instance** with an empty *Testing* column (neither
hidden nor drawable, the owner's shape): a keyboard reorder sent **all five**
column ids and the server answered **200**. Before the fix, this configuration
was the `expected 7, received 5` refusal.

**Mutation:** sending the list of reasons instead of the complement
(`c.hidden && !sent.has(c.id)`) turns `column-reorder.test.ts` **red** on
*"the whole board must go"*. That is AC3's *"fails against the pre-fix
caller"*, re-proved.

**Process, recorded:** there is no SHELL log entry for this task.
