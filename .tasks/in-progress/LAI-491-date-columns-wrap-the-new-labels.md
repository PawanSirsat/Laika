---
id: LAI-491
title: "The List's date columns wrap the new labels onto two and three lines"
area: web
assignee: shell
priority: p1
depends-on: [LAI-486]
discovered-from: LAI-486
status: in-progress
started: 2026-09-28T19:33:32Z
---

## Goal

CREATED and UPDATED hold one line each, whatever the label.

## What this is

Found by CHIEF's final browser pass over LAI-484 to LAI-490, on a 1440 px
viewport. LAI-486 changed what the date cells say:

- from `6d` to `27 Sep, 01:01`;
- from `400d` to `25 Aug 2025, 01:01`.

The columns kept the design's **84 px**, which was sized for the old compact
form. So the new labels wrap:

- `27 Sep,` / `01:01` on two lines;
- `25 Aug` / `2025,` / `01:01` on three;
- `20 min` / `ago` on two.

Every row with a date becomes taller than its neighbours.

## Acceptance criteria

- [ ] No date cell wraps. This is asserted in a browser on the longest form,
      `DD Mon YYYY, HH:MM`, by the `<time>` element's line count, not by a
      width constant.
- [ ] CREATED and UPDATED stay the same width, since they hold the same form.
- [ ] The design-width test re-aims its UPDATED figure deliberately, saying why
      84 px no longer applies (D-065 changed the content). KEY and SPR stay
      pinned.
- [ ] Both themes. Existing tokens only.
- [ ] Full gate.
