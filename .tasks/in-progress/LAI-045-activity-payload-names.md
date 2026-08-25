---
id: LAI-045
title: The activity payload names Drizzle properties, not API fields
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-092
started: 2026-08-25T03:45:43Z
status: in-progress
---

## Goal

`updateTask` builds its activity payload from `Object.keys(changes)`, which are
**Drizzle property names**: `{ changed: ['acceptanceMd'] }`, not
`acceptance_md`. Consistent across every field, so it is a pattern rather than a
slip — Builder-A matched it rather than making one field the odd one out, and
flagged it, which is the only reason it is visible.

**The audit trail is the one place names are read by people rather than by
code.** Everything else in §6.3 is `snake_case` on the wire; `activity` quietly
is not, and a reader comparing an audit row against the API sees two vocabularies
for one field.

## Acceptance criteria

- [ ] Activity payloads name **API fields**, matching §6.3 casing.
- [ ] **Every mutating path**, not just `updateTask` — audit it, and say in the
      log which ones you found.
- [ ] **Old rows still read correctly.** `activity` is append-only (§4.8), so
      history keeps the old names for ever. Either translate on read, or accept
      both and say so — what must not happen is a UI that renders old rows blank
      because it only knows the new spelling.
- [ ] A test that fails if a payload field name is a Drizzle property. **Derive
      the property list from the schema** rather than hand-listing it, so it
      cannot rot.

## Notes / context

Check whether anything **reads** these names before changing them — the task
detail's activity list is the obvious consumer. If it matches on them, both
halves must land together, and the exemption mechanism from D-033 applies.

Not urgent. It is a defect of clarity, not of correctness, and the cost only
grows with the number of rows.

## Renumbered from LAI-101 — PM, 2026-08-25

**Two errors, both mine.** `LAI-101` was already taken (the `format:fix` task,
filed from LAI-005 with four references) **and** 100–199 is Builder-A's range
under D-017 — mine is 001–099. I filed into someone else's range on a number
already in use.

Moved to the next free PM id. **The old LAI-101 keeps its number**: it has
references and §3 is explicit that renumbering an existing task is what LAI-015
had to clean up. This one had none, so it is the cheap one to move — which is
why doing it today mattered.

Builder-A raised it rather than fixing it, which was right: `.tasks/` is mine.
