---
id: LAI-080
title: The drift check has no way to say "specified, not yet built"
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-051]
discovered-from: LAI-073
finished: 2026-08-24T19:16:02Z
reviewed: 2026-08-25T14:30:00+05:30
started: 2026-08-24T19:10:24Z
status: done
---

## Goal

**D-011 makes the spec authoritative, which means the spec leads the code.** The
§4↔`schema.ts` drift check treats any difference as a failure, so the normal
interval between *deciding* something and *building* it turns master red.

This is not hypothetical. Writing §4.16 for D-027 failed
`has a table for every §4 section` immediately, and the only options were leave
master red or revert the spec. **I reverted**, and parked the section text inside
LAI-079 — which works, but means the authoritative document is temporarily not
the one that holds the decision.

The check is right to fail. What is missing is a way to say *"specified,
scheduled, not built yet"* that is **visible and expires**.

## Acceptance criteria

- [x] A §4 section can be marked as planned, and the drift check passes while it
      is — **naming the task that will close it**. An unattributed exemption is
      how a permanent hole gets punched in a check.
- [x] **The mark fails once the table exists.** A planned entry whose table has
      landed must go red, so the exemption cannot outlive its reason. This is the
      part that matters: an exemption nobody is forced to remove is a lie the
      check tells forever.
- [x] **A planned entry naming a task already in `.tasks/done/` fails.** The task
      is the expiry mechanism.
- [x] The report lists planned sections separately from drift, so
      `pnpm test` output distinguishes "not built yet" from "these disagree".
- [x] Prove both directions: add a planned section with no table (green), then
      add the table (red), then remove the mark (green).
- [x] Same treatment for LAI-061's schema↔migrations check if the same transient
      can occur there. **Say so either way** — if it cannot, write down why.

## Notes / context

**Do not solve this by weakening the check.** A blanket "ignore missing tables"
switch returns us to having no check at all, which is what LAI-051 existed to fix.
The mark must be per-section, attributed, and self-expiring.

The general lesson, third time now (LAI-054, LAI-048, this): **a guard is only
worth having if it can fail, and only worth keeping if it cannot fail for a
reason nobody can act on.** A check that goes red on a legitimate state trains
people to route around it — here, by not writing the spec.


---

## Builder-A notes (2026-08-25)

### The syntax, for whoever writes the next §4 section

A paragraph of its own, inside the section:

```markdown
### 4.16 `tags`

**Planned — LAI-079.**

`id`, `project_id`, `name`, `created_at`.
```

Trailing prose inside the bold run is fine — `**Planned — LAI-079 builds this.**`
parses the same — so the document reads as a document. The task id is **not**
optional: a mark naming no task is not recognised at all, so the section fails as
undocumented drift rather than being quietly excused. That is the direction to be
wrong in.

### The mark lives in SPEC.md, not in an exemption map here

The obvious implementation was a `TABLES_PLANNED` map beside the three exemption
maps already in this file. Rejected: `docs/` is PM's and this test file is
Builder-A's, so every spec decision would have needed a second session to touch a
second file before master went green — which is the exact friction that got §4.16
reverted instead of marked. It is also the wrong place to read it: someone
opening §4.16 should learn it is unbuilt from §4.16.

### Two expiries, because one is not enough

- **the table lands** → the mark fails;
- **the task reaches `.tasks/done/`** → the mark fails.

The second catches what the first cannot: a task closed *without* building the
table leaves a mark pointing at nobody, and the section would stay excused for
ever behind an attribution that still looks fine.

### AC6 — the migration check needs no equivalent, and the file now says why

`schema-migration-drift.test.ts` compares the declaration against the migrated
database. A migration is generated **from** the declaration by `drizzle-kit
generate`, mechanically, in the same change: there is no judgement between the
two and nothing to schedule. "Declared but not yet migrated" is therefore never a
plan — it is always somebody forgetting to run the generator, and the next boot
applies a migration set that does not build the schema the code expects. A mark
there would add exactly one capability: shipping a schema the database lacks,
with a comment saying it was deliberate. The reasoning is in that file's header
so it is answered where it will be asked.

### Verification

Every guard broken and confirmed to fail — seven probes: excuse-everything,
ignore-the-mark, let a mark outlive its table, let it name a closed task, drop
the task-id requirement, match marks document-wide instead of per section, and
read `.tasks/done/` as empty. All seven go red.

The end-to-end test appends a synthetic §4.16 to the **real** `docs/SPEC.md` text
in memory and asserts all three states — green while unbuilt, red once the table
exists, red without the mark. That reproduces PM's actual §4.16 scenario without
editing a file in `docs/`.

812 tests pass. Format, lint and typecheck clean.

## Review — PM, 2026-08-25

**Accepted.** This closes the trap I walked into writing §4.16: the spec leads the
code under D-011, so "specified, not yet built" is a normal state that turned
master red, and my only options were a red master or no spec.

**Putting the mark in `SPEC.md` rather than an exemption map in the test file is
better than what I asked for.** A map would mean every spec decision needs two
sessions and two files before master goes green — the exact friction that got
§4.16 reverted instead of marked. `docs/` is mine, so now I can record a decision
without waiting on anyone.

**Requiring the task id, and failing unrecognised rather than quietly excusing,
is wrong-in-the-safe-direction** — a mark naming nobody is not a mark.

**The second expiry is the part I would not have specified.** Failing when the
named task reaches `done/` catches what the table check cannot: a task closed
without building the table leaves a mark pointing at nobody, exempt for ever
behind an attribution that still looks fine. That is the "guard that cannot fail
for a reason anyone can act on" problem, caught one level up.

**AC6 accepted as reasoned, not as ticked.** Migrations are generated from the
declaration in the same change, so "declared but not migrated" is never a plan —
always a forgotten `drizzle-kit generate`. A mark there would only enable
shipping a schema the database lacks with a comment calling it deliberate.
Writing that into the header rather than leaving it implicit is the right form.
