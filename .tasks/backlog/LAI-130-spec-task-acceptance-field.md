---
id: LAI-130
title: SPEC §4.5 and §6.4 should carry the task acceptance field
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-092]
discovered-from: LAI-092
status: done
---

## Goal

LAI-092 AC4 asks for §4.5 and §6.4 (D-011). **`docs/` is PM's**, so it travels.

`tasks` now has `acceptance_md` — nullable text, on `TaskView`, writable on
create and update.

**This one does not need a two-session commit.** `schema-spec-drift.test.ts`
carries a self-expiring entry for it in `COLUMNS_NOT_IN_SPEC`, so master is green
now and **goes red the moment §4.5 lists the field** with *"exempted as
undocumented, but §4 now covers it"*. Verified by simulating the edit locally:
adding the row to §4.5 fails that test, which is the entry expiring correctly.

So: add the field, then remove the exemption entry — the second half is a
one-line deletion in `server/test/` and can be a separate commit by whoever owns
it at the time.

## Acceptance criteria

- [ ] §4.5 lists `acceptance_md` — text, nullable.
- [ ] §6.4's task shape lists it, writable on `POST` and `PATCH`, where `null`
      clears it and absent leaves it alone.
- [ ] The `tasks.acceptance_md` entry is removed from `COLUMNS_NOT_IN_SPEC` in
      `server/test/tooling/schema-spec-drift.test.ts`.
- [ ] `pnpm test` green with both halves applied.

## What was decided, and why (AC3 of LAI-092)

**Prose, not a checklist**, and this is the part worth recording rather than the
column type.

A checklist implies per-item state. Per-item state implies who ticked each item
and when, which is a table, a permissions question, and an activity verb — a much
larger feature wearing a small name. The design shows a single prose line; this
repo's own task files use checklists, which is what makes the temptation real.

Prose is the smaller honest step and **going further later is additive**: a
checklist can be stored as markdown checkboxes in this same field before it ever
needs its own table. Nothing about this choice forecloses the bigger one.

**Not a convention inside `description_md`.** A heading a UI parses out of
markdown is a format nobody can validate and every client re-implements — LAI-092's
Notes are explicit about it, and the field exists so an agent can read acceptance
without parsing prose.

**Limit is 10,000 characters**, against `description_md`'s 100,000. Acceptance
answers "what does done mean here", not "what is this about"; the smaller bound
is a hint about intent as much as a guard.

## Done — PM, 2026-08-25, under D-033

**§4.5 now lists `acceptance_md`**, and I removed the single matching entry from
`COLUMNS_NOT_IN_SPEC` in `server/test/tooling/schema-spec-drift.test.ts` in the
same commit.

**That test file is Builder-A's.** The crossing is authorised by **D-033** and is
named here: *one exemption entry, `tasks.acceptance_md`*, and nothing else in the
file. It was necessary because the entry **self-expires** — the moment §4.5 lists
the column, leaving the entry red-lights master. The two halves could not land
apart.

This is the fourth instance of the pattern and the one that finally changed the
rule rather than being routed around.
