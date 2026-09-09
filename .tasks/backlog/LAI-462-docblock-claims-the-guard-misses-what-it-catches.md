---
id: LAI-462
title: '`schema-spec-drift.test.ts` says it would not have caught LAI-449. It does.'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-163]
discovered-from: LAI-163
status: backlog
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

- [ ] The passage says what is true: **`comments.author_id` is covered**, because
      §4.7 states its nullability. **Keep the argument about silence** — it is
      correct and it is why the reach is bounded — and stop citing LAI-449 as the
      example it fails on. **Pick an example that is genuinely uncovered**, and
      **verify it by mutation before writing it down.**
- [ ] Line 39's *"LAI-449 changed `comments.author_id`'s nullability and nothing
      here moved"* is the same claim in the header. **Both, or neither.**
- [ ] While there: **re-check every factual claim in that docblock against the
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
