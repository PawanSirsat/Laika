---
id: LAI-529
title: 'My day: Who looked shows only who is looking right now — one line a person, nothing else'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-526
started: 2026-10-26T09:07:50Z
status: in-progress
---

## Goal

The owner, 2026-10-26, on the eye's popover: *"here we are showing too much
things that is not needed, only show who looking right now, that's it."*

The popover lists every look as its own row — a day read and the shared local
activity read beside it are two rows, at the same minute, for the same person —
under a *Newest first* label, with *Show more* and a paragraph on who may read
drafts. Five rows for one person who opened the page once.

## Acceptance criteria

- [ ] The popover lists only the people who looked in the last 15 minutes, one
      line each — their name and how long ago their latest look was. Nothing
      else: no kind of read, no day, no *Newest first*, no *Show more*, no
      paragraph on who may read drafts (the header's *Drafts* line says that).
- [ ] With nobody in that window it says so in one line.
- [ ] The eye's badge counts those people, not looks, and is absent at none; it
      stays current while the page is open (read again each minute).
- [ ] The person-day, header and phone browser tests assert the new shape.

## Notes

`GET /me/analytics-views` is unchanged: the log still holds every look (D-102
rule 3); this is what the popover shows of it. A viewer's page reads once when
it opens, so *right now* is a window over the latest look, not a live feed.
