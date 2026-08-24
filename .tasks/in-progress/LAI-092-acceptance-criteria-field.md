---
id: LAI-092
title: Tasks have no acceptance criteria field
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-011]
discovered-from:
started: 2026-08-24T21:14:33Z
status: in-progress
---

## Goal

The design's task detail gives **Acceptance** its own labelled section, distinct
from Description:

> Second claim returns 409 · CLI prints "held by Tomás's agent since 14:02" ·
> audit row written for both attempts.

`tasks` has `description_md` and nothing else. Acceptance would have to be
prose buried in the description, which is where it stops being checkable.

**This board is built for agents to work from** (§1). "What does done mean here"
being a *structured* field rather than a paragraph is the difference between an
agent being able to check its own work and guessing. Every task file in this very
repo has an acceptance list, which is not a coincidence.

## Acceptance criteria

- [ ] `tasks` gains an acceptance field, nullable — most tasks will not have one
      and an empty string is not the same as "not specified".
- [ ] Exposed on `TaskView`, writable on create and update.
- [ ] **Decide prose or checklist and record why.** The design shows one prose
      line; this repo's own task files use checklists. A checklist implies
      per-item state, which implies who ticked it and when — that is a bigger
      feature than it looks. **Prose is the smaller, honest first step** unless
      there is a reason to go further, and going further later is additive.
- [ ] §4.5 and §6.4 updated (D-011); the §4↔schema drift check stays green.
- [ ] Activity records the change as `task.updated` with the field named. **No
      new §4.8 verb** — that vocabulary has been extended enough (LAI-110).

## Notes / context

**Do not reuse `description_md` with a convention** — a heading the UI parses out
of markdown is a format nobody can validate and every client re-implements.
