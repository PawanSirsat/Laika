---
id: LAI-462
title: '`schema-spec-drift.test.ts` says it would not have caught LAI-449. It does.'
area: server
assignee: core
priority: p3
depends-on: [LAI-163]
discovered-from: LAI-163
status: review
started: 2026-09-09T20:30:00Z
finished: 2026-09-09T21:15:00Z
---

## Goal

`server/test/tooling/schema-spec-drift.test.ts:320`:

> *"**It would not have caught what it was filed for.** LAI-449 changed
> `comments.author_id` … the reason is that §4.7 said neither word about it, and
> silence cannot be compared."*

**§4.7 now says `` `author_id` (**nullable**) ``, and the parser reads it.**
Mutating that column to `.notNull()` produces, verbatim:

```
author_id: §4 says nullable and schema.ts says the opposite
```

The sentence was true against the §4.7 the task started from and **stopped being
true when `master` merged in LAI-449's SPEC row.**

## Why a p3 comment is worth a task

**It is wrong in the modest direction, which is the one nobody re-checks.** A
docblock claiming the guard misses something it catches **sends the next person
to build a second guard for a covered case** — and they will believe it, because
it is written as a candid admission rather than a claim.

CLAUDE.md §5: *a comment may not claim more than the assertion under it proves* —
this is the mirror, and it costs the same.

## Acceptance criteria

- [x] The passage says what is true: **`comments.author_id` is covered**, because
      §4.7 states its nullability. **Keep the argument about silence** — it is
      correct and it is why the reach is bounded — and stop citing LAI-449 as the
      example it fails on. **Pick an example that is genuinely uncovered**, and
      **verify it by mutation before writing it down.**
- [x] Line 39's *"LAI-449 changed `comments.author_id`'s nullability and nothing
      here moved"* is the same claim in the header. **Both, or neither.**
- [x] While there: **re-check every factual claim in that docblock against the
      file as merged.** Two were already corrected during the task (`sixteen` →
      27, *"several hundred"* → 191); this is a third, and the pattern says look
      for a fourth rather than assume three was all.

## Notes / context

**Do not soften it into vagueness.** *"May not catch every case"* is worse than
either the wrong sentence or the right one, because it tells the reader nothing
they can check.

**The mutation must typecheck.** CHIEF's first attempt at this inserted
`.notNull()` inside `users.id` and got a red from `tsc`, not from the guard —
confirm with `pnpm --filter ./server exec tsc --noEmit` before believing a red.

---

## Submission note — CORE, 2026-09-09

**Root gate `EXIT 0`** — server 103 files / 1909 tests, `server/web` and `cli`
zero failures, lint / format / typecheck clean.

### The correction is sharper than the task, and not in my favour

Your diagnosis was that the sentence was true against the §4.7 I started from and
went false when `master` merged LAI-449's row. **It was never true.**

```
$ git show 9e96cb7^:docs/SPEC.md | sed -n '/^### 4.7/,+4p'
`id`, `task_id`, `author_id` (**nullable**), `body_md`, ...
```

`9e96cb7` is my own LAI-163 commit, so §4.7 carried the word **before my work
landed** — and my first measurement dump listed `comments.author_id` among the
covered columns on the same day I wrote that §4.7 said neither word about it.

Not staleness. **A claim about a section I read once at the start of the task and
never reopened**, written in the task where two other unmeasured claims had
already been caught.

### AC3 said look for a fourth. There were four more.

| claim | truth |
| --- | --- |
| §4 says `nullable` **27** times | **28** |
| **29** of 191 columns | **30** of 191 |
| `fieldsIn` is "one screen up" | line 65 vs line 350 — **285 lines** |
| the `tokens` row is **§4.5** | **§4.9** |
| `started_at`, `completed_at` are **§4.6** | **§4.5**; §4.6 is `task_dependencies` |

**The last two are the worst.** They are section numbers, swapped and both wrong,
in a comment explaining the fix for a bug caused by not checking a section. One
`grep -n '^### 4\.'` away.

I audited every remaining `§4.N` in the file including LAI-051's. The table/prose
classifications all hold; only my two were wrong.

### The uncovered example, verified before writing it down

`tasks.title` → nullable leaves this file **green**. §4.5's row is
`` | `title`, `description_md` | | `` — one row, two columns, an empty cell — and
it is the sharp case, not a stray: **the two columns genuinely differ**, so §4
could not state them in that shape without splitting the row.

The `comments.author_id` mutation does not typecheck, because `comments.ts`
legitimately inserts a null — which is itself further evidence the column is
nullable. The red is still the guard's: the failure message is
`author_id: §4 says nullable and schema.ts says the opposite`, which `tsc` cannot
produce. Your Notes' trap, checked rather than assumed.

### 29 → 30 with no code change

The new one is `orgs.transcript_webhook_secret_enc`, when §4.2 gained its row
under D-034. **That settles the reframing you offered on LAI-163**: the reach is
a measurement of §4, not a property of this file, and the docblock now says so
and points at `docs/`.

### What I deliberately did not build

A test that reads the docblock's own numbers and asserts them. It would make
every §4 nullability edit — yours — redden a `server/` test, which is the LAI-169
coupling I had just spent a task inside, over a comment's illustrative count.
**Dating them instead** — *"28 times (measured 2026-09-09)"* — cannot become
false.

### One thing outside this task

The gate was red on `task-file-state.test.ts`: **LAI-169 existed in both
`.tasks/backlog/` and `.tasks/review/`**. I filed it into backlog on `core`,
SHELL claimed and finished it on `shell`, and neither branch had the other's
path — so the merge added a file rather than seeing a rename. The same two-copy
shape §2 documents for a send-back, arriving from the filing direction.

I removed **my** stale backlog copy and kept SHELL's authoritative review one, in
its own commit. **`master` carries the same pair**, and this deletion fixes it
there when you merge. Flagging rather than assuming: `.tasks/` is yours, and if
you would rather resolve it on `master` yourself, revert that one commit.
