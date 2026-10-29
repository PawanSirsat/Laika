---
id: LAI-1008
title: 'schema-spec-drift: "states nothing about a column the schema does not have" honours the Planned mark the table checks honour'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-544
status: backlog
---

A guard gap CHIEF found while landing LAI-544 (PR #143, item 7 of its red
list). Filed by CHIEF, built by CORE: the guard is
`server/test/tooling/schema-spec-drift.test.ts`, which is CORE's file, and
CHIEF writes no code (§1). Board: child of LAIKA-785 (Sprint 10, `phase-3`,
`host-belka`).

## Outcome

A §4 section marked **Planned — LAI-NNN** is not yet built, and every
`schema-spec-drift` check should treat it the same way. The table checks
already skip it (`unbuiltTables`), and they expire the mark when the table
lands or the task closes (`marksOutlivingTheirTable`,
`marksNamingClosedTasks`). The nullability check *states nothing about a
column the schema does not have* does not skip it. So every `nullable` column
in a Planned section reads as a "ghost" and reddens the gate. LAI-544 hit
this on the nullable columns of `task_checkpoints`, `handoff_offers` and
`agent_checkpoint_consents` (#143's body, item 6; its task file, item 7).

## Scope

- In the nullability block (`describe('§4 and the schema agree about
  nullability (LAI-163)')`), the ghost check drops statements whose table is
  in `parsePlannedSections(spec)`. It uses the **same** planned set the table
  checks use, not a second parse.
- **The skip expires with the mark.** Once the table exists, the mark is
  already red through `marksOutlivingTheirTable`. So the nullability check
  needs no expiry of its own; a test shows the two together.
- *matches the schema wherever §4 states it* is unchanged: it compares only
  columns that exist.
- Check the column check *has a column for everything §4 specifies* too. It
  already `continue`s when the table is absent, so a Planned table is
  skipped. Say so in a one-line comment backed by a test, or fix it if a test
  shows otherwise.
- Do not widen anything else. Unplanned ghosts must stay red.

## Acceptance criteria

- [ ] A fixture with a Planned section that states a nullable column, and
      no table for it, passes the ghost check; the same fixture without the
      mark fails it
- [ ] A ghost in an unmarked section still fails. Two mutations are each
      seen red on their intended test: dropping the planned filter (the
      marked fixture fails), and skipping every section (the unmarked
      fixture passes)
- [ ] The mark's expiry is unchanged and is shown covering this check
      (table lands → `marksOutlivingTheirTable` red)
- [ ] The repo gate (`pnpm test`, `pnpm lint`, `pnpm format`) exits 0

## Notes

- LAI-1002 fixes the same file's three-digit task-id parsers
  (`PLANNED_MARK`, `closedTaskIds`). They are independent and can land in
  either order. If one person takes both, one branch is fine.
