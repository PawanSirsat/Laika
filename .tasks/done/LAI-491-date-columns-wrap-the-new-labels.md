---
id: LAI-491
title: "The List's date columns wrap the new labels onto two and three lines"
area: web
assignee: shell
priority: p1
depends-on: [LAI-486]
discovered-from: LAI-486
status: done
finished: 2026-09-28T19:35:43Z
started: 2026-09-28T19:33:32Z
reviewed: 2026-09-28T19:35:43Z
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

- [x] No date cell wraps. This is asserted in a browser on the longest form,
      `DD Mon YYYY, HH:MM`, by the `<time>` element's line count, not by a
      width constant.
- [x] CREATED and UPDATED stay the same width, since they hold the same form.
- [x] The design-width test re-aims its UPDATED figure deliberately, saying why
      84 px no longer applies (D-065 changed the content). KEY and SPR stay
      pinned.
- [x] Both themes. Existing tokens only.
- [x] Full gate.

## Built — 2026-09-28T19:35:43Z

Built by the CHIEF session on the owner's direct instruction, on `build`.

- `.list-col-created` and `.list-col-updated` are now `8.5rem`, and the cells
  have `white-space: nowrap`.
- **Red first:** the new test failed on the old CSS with *"20 min ago" wraps
  onto 2 lines*. It is green now, with `25 Aug 2025, 01:01` on screen as its
  positive control.
- The design-width test keeps KEY 74 and SPR 46. Its UPDATED 84 became
  *CREATED = UPDATED*, with the reason in its comment.

Web **1140/1140**; lint green.

## Review — 2026-09-28T19:35:43Z (CHIEF)

**Accepted.** It was found in CHIEF's own final browser pass, then built and
reviewed by the same session on the owner's instruction. It was red first, and
the one-line property is asserted by line count, not by a width.

Both themes will be re-seen on the rebuilt instance before the push.
