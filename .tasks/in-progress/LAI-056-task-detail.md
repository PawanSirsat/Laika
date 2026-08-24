---
id: LAI-056
title: Task detail slide-over
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-049, LAI-055]
discovered-from: LAI-049
status: in-progress
started: 2026-08-24T21:01:34+05:30
---

## Goal

The panel a card opens into (SPEC §11.4.2.1). A slide-over on the Board, not a
route of its own — §11.4.2 lists it as a Board sub-view.

## Acceptance criteria

- [ ] Opens from a card on both kanban and list views; closes on escape and on
      backdrop click; focus moves into the panel and returns to the card on close.
- [ ] Shows description, `created_via` provenance, and the `discovered-from` link
      where one exists.
- [ ] **Dependencies with `BLOCKED BY` relations and each blocker's status** —
      the design's wording. A blocker that is `done` must be visibly different
      from one that is not, since that is the whole reason the list is there.
- [ ] Comments (LAI-047), oldest first, **distinguishing human from agent** via
      `actor_kind` — the badge LAI-020 and LAI-049 already use.
- [ ] Activity trail (LAI-055), newest first.
- [ ] Claim and status controls, reusing LAI-049's transition call so a rejected
      transition behaves identically in both places.
- [ ] Empty, loading, error and permission-denied states from LAI-020. A `403`
      renders permission-denied, never an empty panel.
- [ ] No hardcoded data (CLAUDE.md §5.1).

## Notes / context

SPEC §11.4.2.1, §11.4.2. Style from `docs/design/` — the prototype's screen 2.

**Comments read oldest-first and activity newest-first** in the same panel. That
is deliberate (LAI-047, LAI-055) and will look like a bug to whoever reads it
next; a one-line comment saying why costs nothing now and saves an argument
later.

**Reuse the transition call, do not copy it.** Two implementations of "move this
task" will diverge, and the second one will be the one without the snap-back
LAI-049 tested.

No new dependencies. If a slide-over seems to need a library, file a task naming
it.
