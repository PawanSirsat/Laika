---
id: LAI-569
title: 'The List fits a 1440 screen with the Agent column: no sideways scroll in a space that uses agents'
area: web
assignee: shell
priority: p2
depends-on: [LAI-538]
discovered-from: LAI-538
started: 2026-10-28T21:26:05Z
status: in-progress
---

Filed by SHELL (Belka, dispatched by CHIEF) from the Codex cross-review of
PR #106, which listed it as non-blocking.

## Why

LAI-538 draws the List's **Agent** column only in a space where some task has
a selected agent, and then **adds** its 6.5rem to the table's minimum
(`.list-with-agent { min-width: 78.25rem }` in
`server/web/src/routes/screens/list/list.css`). That keeps the design floor
`list-view.test.ts` asserts (*SUMMARY collapsed to …px* — SUMMARY over 200px),
but at 1440 beside the sidebar the table now scrolls sideways **inside its
card** in such a space. A space with no agents is unchanged.

Taking the room from SUMMARY was tried first in LAI-538 and broke that floor;
taking it from ASSIGNEE or the date columns runs into LAI-491 (dates on one
line) and the design's own widths. It is a layout decision, not a one-line fix.

## Scope

- `server/web/src/routes/screens/list/list.css` (and `ListView.tsx` only if the
  cell's content changes): make the List with the Agent column fit 1440 beside
  the sidebar without sideways scroll, keeping SUMMARY over 200px and every
  date on one line.
- Options to weigh: a narrower agent cell (mark only, device on hover and read
  aloud), narrower ASSIGNEE in that mode, or hiding a low-value column at that
  width.

## Acceptance criteria

- [ ] At 1440×900, with a task that has a selected agent, `.list-scroll` has
      `scrollWidth <= clientWidth` (browser test).
- [ ] `list-view.test.ts` unchanged and green: SUMMARY over 200px, CREATED =
      UPDATED, dates on one line.
- [ ] The agent stays named for a screen reader and on hover.
- [ ] Both themes; repo-root gate exits 0.
