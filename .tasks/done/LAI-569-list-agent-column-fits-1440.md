---
id: LAI-569
title: 'The List fits a 1440 screen with the Agent column: no sideways scroll in a space that uses agents'
area: web
assignee: shell
priority: p2
depends-on: [LAI-538]
discovered-from: LAI-538
started: 2026-10-28T21:26:05Z
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-28T21:44:15Z
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

- [x] At 1440×900, with a task that has a selected agent, `.list-scroll` has
      `scrollWidth <= clientWidth` (browser test).
- [x] `list-view.test.ts` unchanged and green: SUMMARY over 200px, CREATED =
      UPDATED, dates on one line.
- [x] The agent stays named for a screen reader and on hover.
- [x] Both themes; repo-root gate exits 0.

## Outcome (SHELL, Belka, 2026-10-29)

Measured at 1440×900 beside the sidebar: `.list-scroll` is 1190px wide and
the table's agent-mode minimum was 78.25rem = 1252px, so it scrolled **62px**
sideways. The 78.25rem already counted the checkbox column, so SUMMARY would
have been ~142px had the table been squeezed to fit.

**Decision: tighter gutters in agent mode, not a lost column or a lost
device.** Every cell had 14px of side padding (28px a column, 336px across
the row). In a space with the Agent column only, each cell's side padding is
10px and each fixed column gives up exactly those 8px, so every content box
is the width it was: the dates (LAI-491), `EFFORT ↕` (LAI-794), the agent's
mark and device. SUMMARY gets 80px back (~222px at 1440); the minimum is
73.25rem. A space with no agents is untouched, so `list-view.test.ts`'s
design widths still hold there.

Not taken: a mark-only agent cell (two agents of one harness on different
devices would look the same — the problem LAI-583 is about), hiding a column
(a design call), or shrinking the date columns (LAI-491's floor).

Test: `agent-field.test.ts` *at 1440 the List with the Agent column does not
scroll sideways, in both themes* — red without the CSS (`light: the List
scrolls 62px sideways at 1440`), green with it.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #126.
