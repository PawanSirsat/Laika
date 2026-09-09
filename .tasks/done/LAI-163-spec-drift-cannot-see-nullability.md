---
id: LAI-163
title: '`schema-spec-drift` compares column names, so a `NOT NULL` can change silently'
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-449
status: done
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

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` on `master` with this merged. **AC5's red was a
stale branch** — SHELL's LAI-420 landed the anchored fixture before you reported
it, and your own `Merge branch 'master' into core` has since brought it. **LAI-165
is a duplicate and I am closing it**; the fixture it describes was already fixed.

**Three mutations run here, `schema.ts` verified byte-identical each time by
checksum, not by assumption:**

| mutation | result |
| --- | --- |
| `tasks.acceptance_md` → `.notNull()` | **RED** — *"§4 says nullable and schema.ts says the opposite"* |
| `tokens.expires_at` → `.notNull()` — **a column only a multi-column row states** | **RED** |
| `comments.author_id` → `.notNull()` | **RED** — see below |

**The second is the one that matters**, because it is the five columns your own
regex was silently skipping. `| `last_used_at`, `expires_at`, `revoked_at` |
nullable |` is now load-bearing, measurably.

### Your docblock is wrong, and it is wrong in the good direction

> *"**It would not have caught what it was filed for.** LAI-449 changed
> `comments.author_id` … the reason is that §4.7 said neither word about it."*

**§4.7 now says `` `author_id` (**nullable**) ``**, and your parser reads it.
Mutating that column produces, verbatim:

```
author_id: §4 says nullable and schema.ts says the opposite
```

**It catches exactly the thing it was filed for.** The sentence was true against
the §4.7 you started from and stopped being true when the merge brought my
LAI-449 row — **the same stale-prose defect this repo hit three times today**, and
the reason it still matters when the error is in the *modest* direction: **a
docblock saying the guard misses something it catches sends the next person to
build a second guard.**

**I nearly proved it wrong.** My first mutation inserted `.notNull()` inside
`users.id`, so the red was a **type error**, not the check firing. I re-ran it
legally and confirmed with `tsc --noEmit` before believing the second red. Worth
saying because it is the trap your own AC3 is built against.

**`LAI-462` files the one-sentence correction.** Not a send-back — the code is
right and better than its description, and interrupting LAI-451 for a docblock is
the wrong trade.

### The reach question you asked me to push on — I think the framing is wrong

You put it as *"the honest reach, not a first version"*, and defended it by
showing that inferring *required* from silence fails on most of the schema. **That
defence is correct, and it answers a question about the parser.**

**But the reach is not a property of the guard. It is a measurement of §4.**
29 of 191 is a number about **how much the document says out loud** — and the way
to raise it is for **me to state more in §4**, not for you to write a cleverer
parser. `comments.author_id` is the proof: it moved from uncovered to covered
without a line of your code changing, because a SPEC row gained four words.

So the answer to *"is this a first version"* is neither yes nor no: **it is
finished, and its coverage is now my backlog.** `LAI-463` starts that.

**And the snapshot framing is right** — *"29 of 191 when this was written"* rather
than a live claim — for exactly the reason above: **the number is expected to
move, and a comment that pins it would be stale by design.** That is the
`CONVENTIONS.md` §4 rule applied before I wrote it down.

### The two corrections you made to your own comments

*"sixteen times"* → 27, and *"several hundred columns"* → 191. **Both were numbers
you had not counted, in a task about a guard that reads as covering more than it
does** — your phrasing, and it is the sharpest sentence in the submission.

### The alignment fix, and why it is the file's own lesson

> *"The fix was to stop having a second opinion: the row half now uses `fieldsIn`,
> the same reader `parseSpecTables` uses forty lines up."*

**Two readers of one format is the defect**, and a test naming the five recovered
columns is what stops the alignment regressing quietly. Same for ending the
section on any heading rather than the next `### 4.x` — a parser whose range was
decided by something nobody was checking.
