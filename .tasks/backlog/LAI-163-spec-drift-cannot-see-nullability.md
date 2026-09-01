---
id: LAI-163
title: '`schema-spec-drift` compares column names, so a `NOT NULL` can change silently'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-449
status: backlog
---

## Goal

LAI-449 changed `comments.author_id` from `NOT NULL` to nullable — a change to
what §4.7 promises about every comment ever read — and
**`schema-spec-drift.test.ts` said nothing.**

It compares the **set of column names** in §4's tables against `schema.ts`. It
does not read nullability, so §4 can say a column is required while the schema
makes it optional, indefinitely, with the gate green.

**Its sibling does check it.** `schema-migration-drift.test.ts` reads
`PRAGMA table_info`'s `notnull` and compares `schema.ts` to the migrations —
which is why LAI-449's migration was verified and its *spec* was not. So the
three-way chain §4 → `schema.ts` → migrations is checked on two legs and not the
third.

## Why it matters more than it sounds

**Nullability is the half of a column that callers encode assumptions about.**
A name appearing in both places says the column exists; it says nothing about
whether every reader has to handle "nobody". LAI-449's whole cost was in the
seven readers, and none of them is visible to a name comparison.

It is also the shape this repo keeps finding: **a guard whose reach is decided
by something nobody is checking** — LAI-444's census counting names, LAI-448's
staleness test reading two sections, and now a drift check comparing one
attribute of a column and reading as though it compares the column.

## Acceptance criteria

- [ ] `schema-spec-drift` compares nullability where §4 states it, and says so
      in its docblock — the current one describes what it checks and a reader
      would reasonably conclude it covers more.
- [ ] **Decide what "§4 states it" means, and write it down.** §4's tables are
      prose: `nullable, same encryption` says it outright, `for Ollama / vLLM`
      does not. A check that guesses from prose will be wrong in both directions;
      one that requires a convention needs the convention stated.
- [ ] Prove it: flip a column's nullability in `schema.ts` alone and watch it go
      red. Flip one §4 does not state and watch it stay green.
- [ ] Existing disagreements are reported, not fixed silently — if §4 and the
      schema already differ somewhere, that is a finding and possibly a bug.
- [ ] Full gate `EXIT 0`.

## Notes

Found by LAI-449 submitting a nullability change and getting no drift failure
where its own criterion expected one.

**Do not extend this to types.** `text` versus `integer` is a bigger job and §4's
tables are less consistent about it; nullability is the one that is stated often
enough to check and consequential enough to matter.
