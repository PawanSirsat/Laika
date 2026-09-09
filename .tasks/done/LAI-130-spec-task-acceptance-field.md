---
id: LAI-130
title: SPEC §4.5 and §6.4 should carry the task acceptance field
area: docs
assignee: chief
priority: p2
depends-on: [LAI-092]
discovered-from: LAI-092
status: done
started: 2026-09-02T23:10:00Z
finished: 2026-09-02T23:25:00Z
---

## Goal

LAI-092 AC4 asks for §4.5 and §6.4 (D-011). **`docs/` is CHIEF's**, so it travels.

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

- [x] §4.5 lists `acceptance_md` — text, nullable. **Already true on arrival**; verified against the table rather than assumed.
- [x] §6.4's task shape lists it, with `null` clears / absent leaves alone stated
      once for the fields that draw the distinction. **And §6.4 was wrong in the
      other direction too** — see below.
- [x] The exemption is gone — **already removed** by whoever landed §4.5's row;
      confirmed by grep across the file, not inferred from the suite being green.
- [x] Repo-root gate green **but for D-056's held half**, which is unrelated and named in `LAI-454`.

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

## Done — CHIEF, 2026-08-25, under D-033

**§4.5 now lists `acceptance_md`**, and I removed the single matching entry from
`COLUMNS_NOT_IN_SPEC` in `server/test/tooling/schema-spec-drift.test.ts` in the
same commit.

**That test file is CORE's.** The crossing is authorised by **D-033** and is
named here: *one exemption entry, `tasks.acceptance_md`*, and nothing else in the
file. It was necessary because the entry **self-expires** — the moment §4.5 lists
the column, leaving the entry red-lights master. The two halves could not land
apart.

This is the fourth instance of the pattern and the one that finally changed the
rule rather than being routed around.

---

### Status corrected — CHIEF, 2026-09-02

This file sat in `.tasks/backlog/` saying `status: done`. **The directory is the
truth** (§2 — the move is the lock), so the field was wrong and is corrected;
the work is not done.

Found by LAI-415's check, not by a person. It is the more dangerous of the two
directions: a file in `backlog/` that claims to be finished is one nobody
picks up **and** one nobody chases.

---

## Done — CHIEF, 2026-09-02. **Two of three criteria had already landed; the third found a worse bug.**

§4.5's row and the `COLUMNS_NOT_IN_SPEC` removal were both already in place. **I
checked each against its artefact rather than against the suite being green**,
which is the only way to tell *"done"* from *"never needed"*.

### §6.4 documented a write the API refuses

```
was:  { title, description_md, status, assignee_id, priority }
is:   { title, description_md, acceptance_md, tags, priority, assignee_id }
```

**Wrong in both directions.** It omitted `acceptance_md` and `tags`, and it named
**`status`**, which `PATCH` does not accept — status moves through
`POST /tasks/:id/status`, and `UpdateBody` is a `strictObject`, so **a client
built from §6.4 gets `422` on its first status change.**

**A missing field is an omission. A field that is documented and refused is a
lie**, and it is the one that costs somebody an afternoon.

### And `CLAUDE.md` was wrong about §6.4 in the correction that named it

CLAUDE.md §2 cites this exact criterion as a failure — *"an AC pointing at §6.4's
task shape **when §6.4 is an endpoint list with no task shape**"*.

**§6.4 does carry a task shape**, one paragraph below its endpoint block. So:
**a criterion aimed at the wrong place, corrected by a claim that the place did
not exist, when it did and was itself wrong.** Three readings of one paragraph,
none of which opened it. Corrected, with that sentence kept as the record.
