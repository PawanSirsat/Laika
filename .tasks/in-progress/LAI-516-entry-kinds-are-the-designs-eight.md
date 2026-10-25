---
id: LAI-516
title: 'A typed entry''s kind is one of the design''s eight — work, meeting, thinking, research, pairing, review, support, admin — on the server, in SPEC §4 and in the web mirror; the old eight are mapped in a rebuild migration that keeps every row'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: in-progress
started: 2026-10-25T01:20:00Z
---

## Goal

D-108 gave a typed entry eight kinds (meeting, call, review, planning,
learning, support, admin, other). The owner's design uses a different eight
— Work, Meeting, Thinking, Research, Pairing, Review, Support, Admin — and on
2026-10-25 the owner chose them (*"kinds i want"*), amending D-110 item 5.
The CHECK on `time_entries.kind` cannot be widened in place (SQLite), so this
is a table rebuild, and the web side mirrors the list.

## Acceptance criteria

- [x] `time_entries.kind` accepts exactly `work | meeting | thinking |
      research | pairing | review | support | admin`; the timer's `kind` and
      the day-confirm's per-draft `kind` take the same set; anything else is
      `422`.
- [x] A migration rebuilds the table with the new CHECK and maps existing
      rows: call → meeting, planning → thinking, learning → research, other →
      work; meeting, review, support, admin unchanged. Every row survives —
      the migration runs with foreign keys handled the way
      `runMigrations` already does (see the memory on the Drizzle migrator)
      and a test proves a seeded entry of each old kind is still there with
      its new kind after the migration.
- [x] SPEC §4's `time_entries.kind` row and §11's My day wording name the
      new eight (a named cross-area edit by this task).
- [x] `server/web/src/api/time.ts` `ENTRY_KINDS` mirrors the list and the
      drift check stays green; `entry-kinds.ts` carries the design's labels
      and the Timeline colours by kind: Work accent, Meeting blue, Thinking
      green, Research orange, Pairing accent-line, Review red, Support
      blue-line, Admin faint (`kindColors` in the design).
- [x] The timer popover's kinds are *Building · Meeting · Thinking* (Work,
      Meeting, Thinking); the off-screen presets map Brainstorm,
      Whiteboarding, Planning → thinking; Reading docs → research; Helping a
      teammate → support; Interview → meeting.
- [x] Server tests and web tests green; the CLI's `laika time` wording, if it
      names a kind, follows.

## Notes / context

§4.4: a server half and a web half in one task because both are CHIEF's on
the owner's word; the SPEC row is a named edit. D-108 and D-110 item 5 are
amended by this; CHIEF records it in DECISIONS.md on accept.
