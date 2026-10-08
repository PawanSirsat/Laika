---
id: LAI-735
title: 'UI polish — the List card gets a visible edge, and no blank band above Create task'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-08T19:48:24Z
---

## Goal

Made on the owner's direct instruction; UI polish. The builder is a single
agent on branch `build-ui-list-card`, cut from `origin/master` ed1e884;
nothing here is pushed.

The owner's screenshot of the List (light mode) shows two problems:

1. The table card's edge is the same colour as the page, so it reads as a
   smudge rather than a card.
2. A band of empty card sits between the last task row and the pinned
   `+ Create task` row, with its own divider line. Create should sit directly
   under the last row with a single divider, and the card should not be inset
   from the toolbar above it.

## Scope — the exact files (CLAUDE.md §1)

- `server/web/src/routes/screens/list/list.css`
- `server/web/src/routes/screens/list/ListView.tsx` — comment only
- `server/web/test/browser/list-create-row.test.ts` — the few-rows test

## Acceptance criteria

- [ ] The card's border uses an existing token that is visible against the
      canvas, in light and dark.
- [ ] With few rows, nothing selected, the Create row starts within 1px of the
      last row's bottom and ends on the card's foot.
- [ ] With many rows, the Create row stays pinned while the rows scroll and
      never hides the last row (the existing LAI-717 tests still pass).
- [ ] The bulk bar's room still applies only while rows are selected, and the
      bulk bar never covers the Create row or the last row.
- [ ] The card lines up with the toolbar's edges, with no extra padding from
      the List pane.
- [ ] The changed test fails on the old CSS. Each of its two new assertions
      has been run against the old CSS on its own.
- [ ] Screenshots before and after, light and dark, few and many rows.
- [ ] Repo gate `pnpm test`, `pnpm lint`, `pnpm format` exits 0/0/0.
