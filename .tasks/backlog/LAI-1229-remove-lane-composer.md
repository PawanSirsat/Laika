---
id: LAI-1229
title: 'Remove the lane’s inline composer, unused since the lane + opens the Create task dialog'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-1227]
discovered-from: LAI-1227
status: backlog
---

## Goal

LAI-1227 made a board lane's *+ Add task* open the app's one Create task
dialog in that space and column (the owner's brief: in-column adds open the
same dialog). `BoardScreen` no longer sets `composingIn`, so the inline
composer path is unreachable but still shipped:

- `server/web/src/routes/screens/board/ColumnComposer.tsx`
- `LaneRow.tsx`'s `composingIn`, `onCloseComposer`, `onCreated` props and the
  branch that draws `ColumnComposer` (and whatever `KanbanView` passes through)
- the `.composer*` rules and any spacing exemptions that name them

## Acceptance criteria

- [ ] The files and props above are gone; nothing imports `ColumnComposer`.
- [ ] A lane's + still opens the dialog in its column
      (`test/browser/column-create.test.ts` green, unchanged).
- [ ] Gates green: lint, format, web typecheck, web tests, browser shards.

Not done in LAI-1227 to keep that diff to the header and Create, and because
the owner may still want an inline add beside the dialog — confirm before
deleting.
