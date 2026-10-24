---
id: LAI-508
title: 'My day: the editor lives in the right column — tapping any block, gap or stretch opens it there; Agent time and On your plate show there only while nothing is selected'
area: web
assignee: chief
priority: p1
depends-on: [LAI-502]
discovered-from: LAI-502
status: done
accepted: 2026-10-24T11:36:25Z
finished: 2026-10-24T11:31:17Z
started: 2026-10-24T11:22:01Z
---

## Goal

The owner, 2026-10-24, on seeing the header land: *"we need to remove what we
have on the right side, and when we tap on any time that will open on the
right side and we can do that change there."* The design (`MyDay.dc.html`,
D-110) has the editor beside the lists, not under the Timeline. So: the right
column holds the editor whenever something is selected — a block, a gap, a
range, a break, a tray item — and Agent time and On your plate only while
nothing is. The lists keep the left column under the Timeline.

## Acceptance criteria

- [x] With nothing selected the right column shows Agent time and On your plate, as today, and no empty editor.
- [x] Tapping a block, a gap, a dragged range, a break or a list row opens the editor in the right column, in place of those two cards; letting go (Esc, Cancel, confirming the last draft) brings them back.
- [x] The editor column is sticky under the Timeline on a tall page, so a long list never scrolls it away.
- [x] Under 62rem the column drops below the lists as the layout already does; under 34rem the editor stays where LAI-506 will put it.
- [x] Every browser test that located the editor under the Timeline is re-aimed; both themes at 1440 and 1024.

## Notes / context

`MyDayScreen.tsx` renders `Inspector` first in `.myday-main` and the side
column in `.myday-side`; this moves the `Inspector` into the aside and gates
the two cards on `selection === undefined`. `my-day.css`'s `.myday-grid`
already has the two columns and the 62rem container query.

## Notes from the build (CHIEF, 2026-10-24)

- The `Inspector` moved from `.myday-main` into the aside, drawn only with a
  selection; the aside says `data-side="editor"` or `"cards"`. The column is
  the aside that was already sticky and bounded (LAI-810), so a long list
  never scrolls the editor away; it widened to 19–24rem for the fields.
- The day still opens on its first draft (the keyboard flow, J/K/↵, starts
  there); Esc now lets go of any selection and hands the column to the cards.
  Nine browser cases that read the cards press Esc first, after the page is
  ready — the first attempt pressed it before the page had loaded.
- The phone criterion: under 62rem the aside drops below the lists as it did;
  LAI-506 makes it a drawer under 34rem.
