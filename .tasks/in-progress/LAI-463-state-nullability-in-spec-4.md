---
id: LAI-463
title: '§4 states nullability for 29 of 191 columns — raise it where it carries meaning'
area: docs
assignee: chief
priority: p2
depends-on: [LAI-163]
discovered-from: LAI-163
status: in-progress
started: 2026-09-03T00:05:00Z
finished:
---

## Goal

LAI-163's guard compares §4's nullability statements against `schema.ts`. **It
reaches 29 of the schema's 191 columns**, and that number is **not a limitation
of the guard** — it is a measurement of how much §4 says out loud.

`comments.author_id` proves it: **it moved from uncovered to covered without a
line of the guard changing**, because §4.7 gained four words.

**So raising the reach is a `docs/` job.** This is it.

## Acceptance criteria

- [ ] **Every nullable column whose nullability carries a rule** is stated in §4.
      Not all 191 — the goal is not a number.
- [ ] **The selection criterion is written down in the task before the edits**, so
      the next pass is repeatable rather than a matter of taste. The starting
      rule: **state it wherever the null has a meaning a reader must know** —
      `author_id` null *means* "no Laika author"; `deleted_at` null *means* "not
      deleted"; a nullable `description` means nothing beyond "optional".
- [ ] **Run the guard after each batch, and report what it caught.** If §4 and
      the schema already disagree anywhere, **that is a finding, not an edit** —
      file it against `server/` rather than changing §4 to match the code. **The
      document is the statement of intent; the schema is what happened.**
- [ ] The new count is recorded **as a snapshot with its date**, in the same shape
      LAI-163 used — never as a live claim (`CONVENTIONS.md` §4).
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Nullability is only the first axis.** `schema-migration-drift.test.ts` already
compares type, nullability and primary key between schema and migrations; §4 is
the third party and states the least. **Do not extend this task to types** —
decide that separately once this one has shown what the effort per column
actually is.

**This is one of the two ways a guard's reach grows.** The other is a cleverer
parser, and LAI-163 argued convincingly that inferring *required* from silence
fails on most of the schema. **Stating it is the direction that works**, and it is
the one nobody was doing.
