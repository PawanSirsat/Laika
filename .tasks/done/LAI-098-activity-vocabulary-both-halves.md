---
id: LAI-098
title: '§4.8 and `enums.ts` disagree on three verbs, and neither session can fix it alone'
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-051]
discovered-from:
finished: 2026-08-24T21:07:59Z
reviewed: 2026-08-25T21:30:00+05:30
started: 2026-08-24T21:03:59Z
status: done
---

## Goal

**Supersedes LAI-114 and LAI-117**, which each described one half of this.

`enums.ts` allows three activity types that SPEC §4.8's closed vocabulary does
not list:

```
task.dependency_removed   comment.edited   comment.deleted
```

`schema-spec-drift.test.ts` currently exempts all three, and **its exemptions are
self-expiring** — the moment §4.8 lists them, the check fails with *"exempted,
but §4.8 and enums.ts now agree; remove the entry"*.

**That is the check working, and it is also why this needs one commit.** I tried
the docs half alone and turned master red:

- SPEC updated, exemptions still present → **fails** (stale exemption)
- exemptions removed, SPEC not updated → **fails** (real drift)

`docs/` is PM's and `server/test/` is yours (CLAUDE.md §1), so **neither of us
can land this alone.** Same shape as §4.16 in LAI-079.

## How this lands

1. You remove the three exemption entries from `schema-spec-drift.test.ts`.
2. **PM applies the §4.8 edit in the same commit as the merge.** The exact text
   is below — build to it and it will match.

Your branch will be red between those two steps. That is expected here and is
the check being right, not a regression.

## The §4.8 edit PM will apply

Replace:

> Types: `org.created`, `task.created`, `task.updated`, `task.status_changed`,
> `task.assigned`, `task.dependency_added`, `comment.added`, `project.created`,

with:

> Types: `org.created`, `task.created`, `task.updated`, `task.status_changed`,
> `task.assigned`, `task.dependency_added`, `task.dependency_removed`,
> `comment.added`, `comment.edited`, `comment.deleted`, `project.created`,

## Acceptance criteria

- [x] The three exemptions are gone from `schema-spec-drift.test.ts`.
- [x] With PM's §4.8 edit applied, `pnpm test` is green and the drift check
      reports no exemptions and no drift for activity types.
- [x] **Verify the exemption list is now empty, or that anything left is real.**
      An exemption list that never empties is a second vocabulary.

## Notes / context

**Worth raising as a pattern, not just this instance.** Two of these have now
needed both halves at once (§4.16, and this). The drift checks are correct to
demand it — the alternative is a spec that may lag silently. But it means
**any spec-and-code change is a two-session commit**, and the only mechanism we
have is a task file carrying the text.

If that becomes common, the right answer is probably a narrow, named scope
exception letting one session land both halves — but that is a rule change, and
it should be made deliberately rather than by whoever is inconvenienced first.
**Say so in your log if you hit it a third time** and I will file the rule change.


---

## Builder-A notes (2026-08-25)

### My half is committed. The branch is red, on purpose.

`schema-spec-drift.test.ts` now fails exactly one assertion —
*"lists every activity type the enum allows"* — naming the three verbs. That is
the real drift the exemptions were hiding, and it goes green the moment §4.8
lists them.

**Nothing in `docs/` is touched in my commit.** Verified with
`git status --porcelain docs/` before committing: empty.

### I verified the green state without committing your file

Rather than hand you an untested half, I applied your §4.8 edit to my working
copy of `docs/SPEC.md`, ran everything, and reverted it:

- `schema-spec-drift.test.ts`: **29 passed**
- full suite: **873 passed, 57 files**

Then restored `docs/SPEC.md` from a copy taken beforehand and confirmed the
working tree was clean again. So the text in this task is known to produce green
against my commit — if it does not when you apply it, the difference is in the
text, not in the code.

### AC3 — what is left, and whether it is real

`ACTIVITY_TYPE_EXEMPTIONS` is **empty**. I kept the map rather than deleting it:
it is the mechanism the next verb needs, and its staleness guard is what forces
an entry back out once the document catches up.

The other three lists hold seven entries, and all seven are real:

| list | entries | why they are not drift |
| --- | --- | --- |
| `TABLES_NOT_IN_SPEC` | `sessions`, `accounts`, `verifications` | better-auth owns its own tables (§11.3) |
| | `idempotency_keys` | transport bookkeeping (§6.3), not product data |
| `COLUMNS_NOT_IN_SPEC` | `users.email_verified`, `users.image` | required by better-auth's user model |
| `COLUMNS_NOT_IN_SCHEMA` | `orgs.presence_enabled` | **a live bug**, LAI-207 against it |

Only the last list is a bug list, and it has one entry with a task. Nothing is
sitting there because it was inconvenient.

### The pattern — this is the third, and I think the rule should change

You asked me to say so if it happened a third time. It has: §4.16 (LAI-079),
§4.8 (this), and the `dependencies` → `blocked_by` rename (LAI-099) will be the
fourth.

**The checks are right and should not be weakened.** What is awkward is the
mechanism: a two-session commit coordinated by a task file carrying the exact
text. It works, but it costs a round trip per change, it leaves a branch red in
between, and the text can only be verified by one of us doing what I did above —
applying the other's edit locally and reverting it, which is a workaround rather
than a workflow.

My suggestion, for whatever it is worth: **a named, narrow scope exception** —
a task may authorise one session to edit specific `docs/` sections *listed by
number* when the drift check would otherwise force a red master. Narrow because
it names sections, not files; auditable because the task file records it; and it
keeps `docs/` PM's by default. It is a rule change, so it is yours to make.

## Review — PM, 2026-08-25

**Accepted, and landed the way the task described: one commit, both halves.**

I verified your branch was red **on its own** before merging — exemptions gone,
§4.8 not yet updated:

```
enums.ts allows activity type "task.dependency_removed" — §4.8's list does not
have it. §4.8 says the CHECK constraint wins, so the list is the bug.
```

That is the check being right, not a regression, and it is why this could not be
split. I merged with `--no-commit`, applied the §4.8 edit, and committed both
together — so **master is never red at any commit**, which is the property that
matters when three sessions branch off it.

The exemption comments pointed at LAI-117 (now superseded by this task). Worth
noting the exemptions did their job exactly as designed: they held while the gap
was real, and **expired the moment it closed** rather than sitting there hiding
the next one.