---
id: LAI-897
title: 'My day: drag a range on the Timeline and add an entry with a title, a description and a type — Meeting, Call, Review, Planning, Learning, Support, Admin, Other — a card if you want; the block wears the type''s colour'
area: web
assignee: chief
priority: p1
depends-on: [LAI-895]
discovered-from: LAI-888
status: in-progress
started: 2026-10-23T09:12:49Z
---

## Goal

The owner, 2026-10-23: *"one feature where I don't need a card: we can also
manually, in the timeline, by selecting the time, add [an entry]; also we
can add the title and description for those we don't have a card; also we
can add the card in that if we want. Also we need the type, like meetings
and other types, and depending on that the timeline card colour and theme
change."* Choices: eight types; the form opens beside the Timeline in the
editor panel.

Plan: `~/.claude/plans/mighty-dancing-leaf.md` (D-107 records the decisions).

## Acceptance criteria

- [ ] Server: `time_entries.kind` (one of the eight, null = untyped),
      `title` (≤120), `description` (≤2000), copied into revisions;
      migration 0052 as plain ADD COLUMNs; `POST`/`PATCH /me/time-entries`
      take and answer them, strict bodies; `createEntry` refuses a span
      outside its day as PATCH already does; the Solidtime outbox carries
      the title and the CLI sends it, else the note. Tests.
- [ ] SPEC §4.48, §4.49 and §6's body line; D-107 (named cross-area edits).
- [ ] Web: eight kinds with glyph and label, equal to the server's list by
      test; 24 tokens in both themes, listed; `rangeFromDrag`/`freeAround`
      with unit tests; a drag on an empty stretch of the You row selects a
      five-minute-snapped range clipped to the free stretch; the Inspector
      opens a New entry panel for it (type, title, description, card or
      General, the end adjustable) and Add posts the exact range; the gap
      panel's *Add time here* opens the same panel; the entry panel edits
      kind, title, description and note; blocks wear `data-entry-kind` and
      the kind's colour; labels show the title when there is no card; the
      Add time form carries the same fields.
- [ ] Browser tests for the drag, the clip, the post, the title rule, a 409
      shown verbatim, Esc, the gap path and the colours in both themes.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` exit 0.
