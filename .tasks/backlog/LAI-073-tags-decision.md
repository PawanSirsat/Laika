---
id: LAI-073
title: Task tags exist in the design and nowhere else — decide whether they are real
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

**Every task card in the prototype carries a tag chip** — `presence`, `core`,
`agent`, `auth`, `ui`, `infra`, `audit`. They are used as the primary visual
grouping on the board.

They exist nowhere else:

- no column in `server/src/db/schema.ts`
- nothing on `TaskView`
- **no mention anywhere in `docs/SPEC.md`**
- never filed as a task before this one

This is a **product decision, and it is the owner's** — the same reasoning as
D-020 for design tokens. PM measured the gap; PM does not get to add a feature to
the spec by writing it down. **This task needs an answer before it can be worked.**

## The decision

**Are tags part of Laika?**

- **Yes** → SPEC §4.4 gains them, the schema gains a table or column, the API
  returns them, and LAI-066 grows the chip. Free-form strings or a controlled
  vocabulary is part of the same answer.
- **No** → they come out of the design reference, joining the list in
  `docs/design/README.md` of prototype artifacts not to reproduce, and LAI-066's
  exclusion becomes permanent.

## Acceptance criteria

- [ ] The decision is recorded in `docs/DECISIONS.md` with its reasoning.
- [ ] If yes: SPEC §4.4 and §6.4 updated, and the schema/API work filed as its
      own `server` task with LAI-066 depending on it.
- [ ] If no: `docs/design/README.md` gains the row, and LAI-066's "Explicitly NOT"
      section is marked settled rather than pending.

## Notes / context

Worth deciding rather than drifting into. Tags are cheap to add and expensive to
remove once boards depend on them, and they overlap with things Laika already
has — `priority`, `sprint_id`, and `discovered_from` all group work already. The
honest question is what a tag would carry that those do not.

`docs/design/README.md` already tracks three of these design-ahead-of-spec gaps
(a `repo` per project — since resolved by LAI-108 — an org presence toggle, and
the Calendar screen). **This is the fourth**, and the pattern is worth noting:
the mockup is a richer product than the spec describes.
