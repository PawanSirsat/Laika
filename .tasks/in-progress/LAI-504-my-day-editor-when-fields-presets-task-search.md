---
id: LAI-504
title: 'My day: the editor from the design — typed Start / End / Length with chips and Ends now, a free-stretch bar, off-screen presets, task search, kind and words on a draft, split at a time, the untimed picker'
area: web
assignee: chief
priority: p1
depends-on: [LAI-500]
discovered-from: LAI-897
status: in-progress
started: 2026-10-24T12:51:53Z
---

## Goal

D-110 items 5, 7, 8 and 9: the editor's WHEN section with typed fields and a
free-stretch bar; the *No set time* toggle on a compose; the untimed picker for
tray items; OFF-SCREEN WORK presets; a task search over the tasks the person may
read; KIND and WHAT IT WAS on a draft, applied on confirm; SPLIT at a typed time;
the footer with the primary action and its key.

## Acceptance criteria

- [ ] Start, End and Length accept `14:15`, `2:15pm`, `45`, `45m`, `1h 15`, `1:15`; changing one updates the others; saves on blur; inline errors for under 5 min, crossing midnight, and the server's 409 verbatim; chips 15 / 30 / 45 / 60; *Ends now* today only.
- [ ] The free bar draws logged time, the selection, now and hour ticks; click places, drag moves.
- [ ] *No set time* posts minutes alone; a tray item opens the picker prefilled to the last free stretch of its length and saves a span.
- [ ] Presets set title and kind, and General when no card; a unit test holds every preset's kind in `ENTRY_KINDS`.
- [ ] Task search filters `listAllTasks` by key prefix or title substring, eight results; no create; the chips stay.
- [ ] A draft takes a kind, a title and a description, sent with its confirm; picking a kind alone puts a cardless draft on General.
- [ ] Split at a typed time within (start+5, end−5), midpoint as default.
- [ ] Shortcut sheet gains `T` and the design's group names; browser tests in both themes.

## Notes / context

D-110. `splitAt` / `splitUnderstood` in `my-day-derive.ts` already parse a time.
