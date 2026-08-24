---
id: LAI-100
title: Nothing checks SPEC §3 against `can()`
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-004]
discovered-from: LAI-111
started: 2026-08-24T21:50:19Z
status: in-progress
---

## Goal

`matrix.test.ts` calls itself *"the executable version of SPEC §3.1 and §3.2"* —
but it **restates** the matrix in TypeScript rather than reading it. So the two
can disagree silently, and the test would keep passing.

Found while settling LAI-111: I checked whether editing §3.1 would break a test
before touching it. It would not — which is convenient today and is the gap.

**This is the same class as §4↔`schema.ts` (LAI-051) and `schema.ts`↔migrations
(LAI-061), on the one axis still unguarded.** Those two exist because the same
drift went unnoticed twice; §3 is the remaining side of the same shape, and it is
the one governing **who may do what**.

## Acceptance criteria

- [ ] A check reads the §3.1 and §3.2 tables out of `docs/SPEC.md` and compares
      them against `can()` — every action, every role, both directions.
- [ ] It fails when a matrix row has no action, when an action has no row, and
      when a **cell disagrees** — the last is the one that matters and the
      easiest to omit.
- [ ] Prove all three by making each change and watching it go red.
- [ ] Rows that are prose rather than a matrix cell — like LAI-111's paragraph on
      the org activity feed — must be handled deliberately: either parsed, or
      **listed as prose exemptions with a reason**, never silently skipped.
- [ ] Reuse LAI-080's planned-mark if §3 needs to describe something not yet
      built. Do not invent a second mechanism.

## Notes / context

**`matrix.test.ts` stays.** It is the executable contract and it is good. This
adds the link between it and the document it claims to be executing — right now
that claim is unverified.

The parsing is the fiddly part and the reason to do it once, carefully: markdown
tables with `✓`, `—`, and qualifiers like `✓ (not to Owner)` and
`✓ (read_only forced)`. **A qualifier that the parser silently drops is worse
than not parsing at all** — it would assert agreement on a cell whose meaning it
had discarded.
