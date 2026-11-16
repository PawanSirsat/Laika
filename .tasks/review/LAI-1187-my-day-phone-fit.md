---
id: LAI-1187
title: 'My day at 390 px: Year heat-key swatches zero-wide, Viewing control under the avatar, Day note label overflowing'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-1184
status: review
finished: 2026-11-16T07:37:34Z
started: 2026-11-16T06:50:00Z
---

## Goal

Three phone-width defects build-1184 saw while shooting LAI-1184's
screenshots on 2026-11-16, all pre-existing on master:

1. **Year heat key:** the phone rule `.span-year-day { width: auto }` in
   `span.css` also matches the key's `.span-year-day.span-heat-swatch`, so its
   12 px swatches are 0 wide — the key reads "Less More" with nothing between.
2. **Phone bar:** the *Viewing* control runs under the avatar
   (`MyDayPhoneBar` and its CSS).
3. **Empty past day:** the phone summary's *Day note* button text overflows
   its box.

## Acceptance criteria

- [x] At 390 px, both themes: the heat key shows its swatches at their size;
      the Viewing control and the avatar never overlap; *Day note*'s label sits
      inside its button.
- [x] Each asserted in a browser test that measures the element against its
      container / neighbour (bounding boxes), not page scroll — red on the old
      CSS first, then green.
- [x] No change at 1440 (the existing My day browser files stay green).

## Notes

- Shipped in PR B (D-149's marks) on LAI-1184's branch: same screen, one CI
  run (owner's batching rule, 2026-11-01). Commits carry `[LAI-1187]`.

## Built

By build-1184 on LAI-1184's branch (9bdda109, 4f697c63; log 17df5f1a): the bar's
brand keeps its mark, gaps 6 px, *Viewing* drops below 420 px, the name
ellipsises; *Day note* sized to its words; the Year key's phone rule scoped to
the grid; a settled-theme wait before the Year shot. Bounding-box assertions in
my-day-phone and my-day-span, each seen red on the old CSS. At integration
(c0d2376e, LAI-1185) the long availability pill gained a short head in the bar
("On leave", "Away"), the full words kept in its title and name.
