---
id: LAI-163
title: '`schema-spec-drift` compares column names, so a `NOT NULL` can change silently'
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-449
status: review
started: 2026-09-02T01:45:00Z
finished: 2026-09-09T14:45:00Z
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

- [x] `schema-spec-drift` compares nullability where §4 states it, and says so
      in its docblock — the current one describes what it checks and a reader
      would reasonably conclude it covers more.
- [x] **Decide what "§4 states it" means, and write it down.** §4's tables are
      prose: `nullable, same encryption` says it outright, `for Ollama / vLLM`
      does not. A check that guesses from prose will be wrong in both directions;
      one that requires a convention needs the convention stated.
- [x] Prove it: flip a column's nullability in `schema.ts` alone and watch it go
      red. Flip one §4 does not state and watch it stay green.
- [x] Existing disagreements are reported, not fixed silently — if §4 and the
      schema already differ somewhere, that is a finding and possibly a bug.
- [ ] Full gate `EXIT 0`. — **NOT MET, and not by this change.** See the
      submission note below.

## Notes

Found by LAI-449 submitting a nullability change and getting no drift failure
where its own criterion expected one.

**Do not extend this to types.** `text` versus `integer` is a bigger job and §4's
tables are less consistent about it; nullability is the one that is stated often
enough to check and consequential enough to matter.

---

## Submission note — CORE, 2026-09-09

**The root gate is `EXIT 1` and AC5 is deliberately unticked.** Four failures,
all in `server/web/`, all present with this change stashed on a clean tree.

```
server/web test: not ok 76 - the WORKING NOW strip
                 locator.waitFor: Timeout 20000ms exceeded
                 waiting for locator('.presence-chip').first() to be visible
server/web test: not ok 85 - the sprint tabs select what the strip describes
                 'S4' !== 'S3'
                 The input did not match /STARTS IN/. Input:
                 'S4\nDONE 0/0\nBLOCKED 0\nWIP 0\nDAYS LEFT 12'
```

Filed as **LAI-165** (p1, the expired sprint fixture — three tests, every run)
and **LAI-166** (p2, the 20s presence wait that takes 1883ms alone). Neither is
fixable from here: `server/web/` is SHELL's under D-031, and both are real
behavioural fixes rather than a named one-line crossing under D-033. **LAI-165 is
what turns the gate green.**

Green where this change reaches:

| | |
| --- | --- |
| `server` alone | **`EXIT 0`** — 102 files, 1871/1871 |
| `pnpm lint` | `EXIT 0` |
| `pnpm format` | all files match |
| `pnpm typecheck` | server, server/web, cli all Done |
| this file | 35/35 |

### AC3 — the proof, three mutations

`schema.ts` restored and sha256-verified identical after each; the anchor was
asserted present before each run, so a probe that did not apply could not
report green.

| mutation | wanted | got |
| --- | --- | --- |
| `tasks.acceptance_md` → `.notNull()` (§4 says nullable) | red | **red** — *"§4 says nullable and schema.ts says the opposite"* |
| `activity.org_id` → drop `.notNull()` (§4 says not null) | red | **red** — the one `not null` statement, so that branch is live |
| `tasks.title` → nullable (§4 states nothing) | green | **green** |

### AC4 — the existing disagreements

**There are none.** All 29 statements parsed from §4 are present in the schema
and all 29 agree; zero ghosts. The list is 5 `activity`, 8 `tasks`, 3 `tokens`,
3 `invites`, 2 `orgs`, 2 `projects`, 2 `unlisted_work`, and one each on
`comments`, `heartbeats`, `sprints`.

### What a reviewer should push back on

**The reach is 29 of 191 columns**, and the docblock says so with the date
attached. It is bounded by what §4 says out loud, so a column §4 merely lists
can still change nullability silently — including `comments.author_id`, the one
that prompted this. I think that is the honest reach rather than a first
version, but it is the judgement most worth disagreeing with.
