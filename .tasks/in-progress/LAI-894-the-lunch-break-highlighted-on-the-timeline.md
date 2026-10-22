---
id: LAI-894
title: 'My day: the organisation''s break is a pill on the timeline — icon, name, the time worked in it — with the window tinted and the work in it hatched, as the Timeline design draws it'
area: web
assignee: chief
priority: p1
depends-on: [LAI-956]
discovered-from: LAI-888
status: in-progress
started: 2026-10-22T18:29:57Z
---

## Goal

The owner, 2026-10-22 (with a screenshot of the Timeline design): *"make the
lunch break something like this … highlight the lunch break properly on top,
short, the icon."* The design (`docs/design/Timeline.dc.html`, refreshed from
the project tonight) draws the organisation's break as:

- a **band** over the window, tinted green with dashed edges;
- a **pill** in the strip above the blocks, at the band's top: a fork glyph,
  the window's label in bold, its range in mono when there is room, and at
  the right, in the accent, **what was worked in it** — `30m worked`,
  `worked through`, or `offline`; under the pill a 3px bar, green where the
  person was off and accent where they worked, in the window's proportions;
- **hatching** over each block's part that lies inside the window.

**This amends D-101 item 4** ("nothing anywhere compares a person's actual day
against it — no 'worked through lunch'"): the owner has now asked for exactly
that figure, by picture. Recorded as D-105. Work in the window still creates,
clips and removes nothing; the schedule is still never time.

## Acceptance criteria

- [ ] `timeline-derive.ts`: `workedIn(blocks, span)` — the minutes of the window
      covered by any confirmed or drafted block, and the runs (worked / not)
      across the window in order, from minute-level overlap; unit tests, the
      stacked and the partly-overlapping cases included.
- [ ] The band (`[data-scheduled-break]`) is tinted with the green chip tokens
      and dashed in the green border; still `pointer-events: none`, still
      behind every block, gap and break, and the gap rule under it unchanged.
- [ ] The pill (`[data-scheduled-pill]`) sits in the strip above the blocks at
      the band's top, as the design: fork glyph, label, range if it fits,
      the worked label right-aligned in the accent when anything was worked,
      the segment bar beneath. It shrinks before it overflows: the worked
      label goes first, then the range, and the glyph and label stay. Its
      `title` says the window, the time off, the time worked and the cards.
- [ ] Hatching (`[data-scheduled-bite]`) over the part of each block inside the
      window, never catching the pointer, light on a confirmed block and the
      green tint on a drafted one.
- [ ] Both themes, tokens only (the theme single-source check stays green).
- [ ] `org-breaks.test.ts` re-aimed: the band now says what was worked (e2 is
      12:00–12:30 over a 12:00–13:00 window: `30m worked`), the pill is there,
      the hatch is over e2's half, and everything else that test asserts holds.
      A fixture with no block in the window says `offline`; one covering it
      says `worked through`.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes

- `docs/design/Timeline.dc.html` and `timeline-core.js` refreshed from the
  design project (the project's copies carry `LUNCH` and the pill; the local
  ones from 16:32 did not). README notes it.
- The design's lunch *panel* (the footer with ‹ 15m earlier / later ›, which
  moves the window for the day) is **not** built: D-101 keeps the schedule
  organisation-wide, and the owner asked for the highlight.
