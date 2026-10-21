---
id: LAI-851
title: 'Needs attention''s rows start each title after its own key, so OR-21 and OR-104 put their titles at different places'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-832
status: backlog
---

## Goal

The titles in a Needs attention list start at one x, whatever the length of
the key beside them, as the List and Jira's lists do.

## Found (LAI-832, 2026-10-21)

Seen in LAI-832's screenshots of the OnRoute-shaped fixture
(`test/browser/onroute-dashboard.ts`), Blocked tab, at 390 and 1440, light and
dark, and more so under a wider font: under `OR-17` … `OR-21` the titles share
one edge; under `OR-104` and `OR-105` they start about one character further
right. Pre-existing; LAI-832 did not touch these rows.

The cause is in `server/web/src/routes/screens/dashboard/dashboard.css`:
`.dash-att-row` is its own grid, `grid-template-columns: auto minmax(0, 1fr)`,
so each row sizes the key column to its own key. LAI-842 fixed the same shape
in My day by making the list one grid with subgrid rows, so a column is as wide
as its widest cell on any font.

## Acceptance criteria

- [ ] In every Needs attention tab (and the "Not counted" list), every row's
      title starts at the same x, measured in a browser test with keys of
      different lengths, at 1440 and 390, on our font and a wider one
      (letter-spacing 0.12em). Red first on today's CSS.
- [ ] No row, key or title is cut, and the page does not scroll sideways at
      390.
- [ ] Both themes. Font sizes stay D-094 step tokens.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
