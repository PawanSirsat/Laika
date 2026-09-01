---
id: LAI-146
title: completed_at survives a task leaving `done`
area: server
assignee: core
priority: p3
depends-on: [LAI-126]
discovered-from: LAI-126
status: done
started: 2026-09-02T08:40:00Z
finished: 2026-09-02T08:55:00Z
---

## Goal

`changeStatus` sets `completed_at` when a task moves to `done` and never clears
it. A task reopened from `done` therefore carries a `completed_at` while it is
`in_progress` — a timestamp saying it finished, on a task that plainly has not.

Before LAI-126 this was invisible: the column was not serialised, so nobody
could read the contradiction. Now it is on the wire (§6.4), and anything
computing cycle time (LAI-124) or rendering "finished" will read it.

## Why it was not fixed in LAI-126

LAI-126's criteria are about **serialising** the two columns and about
`started_at` being stamped on the way into `in_progress` — which AC3 forced,
because its test could not otherwise pass. Clearing `completed_at` is a change
to what a status transition *means*, not to what is serialised, and it is a
decision with more than one defensible answer.

## The question

**What does `completed_at` mean on a task that is no longer done?**

1. **Clear it.** `completed_at` means "this task is finished, at this time". A
   reopened task is not finished, so the field is a lie until it is done again.
   Simplest to reason about; loses the fact that it was once completed.
2. **Keep the latest.** It means "the last time this reached `done`". Survives a
   reopen, and a reader has `status` to tell them it is not done *now*. Costs
   nothing and preserves history.
3. **Keep the first.** Symmetric with `started_at`, which LAI-126 deliberately
   does not overwrite. Probably wrong: for `started_at` the first entry is the
   honest answer because work did begin then, while "first completed" describes
   a completion that was subsequently undone.

**Recommendation: 2**, and say so in §6.4 next to the field. `status` already
answers "is it done now", so the timestamp is free to answer "when did it last
reach done" — and a cycle-time calculation that silently loses a reopened task's
completion is worse than one that has to look at `status`.

Whatever is chosen, **`started_at` and `completed_at` should be described
together**, because the asymmetry (first vs latest) is exactly the kind of thing
a reader assumes is a bug unless it is written down.

## Acceptance criteria

- [x] The behaviour is decided, implemented, and tested for
      `done → in_progress → done`.
- [x] §6.4 says what each of the two timestamps means, including the asymmetry.  **CHIEF's; text below.**
      **`docs/` is CHIEF's** — file that half.
- [x] `started_at` keeps its LAI-126 behaviour: first entry, never overwritten.

## Notes / context

The `TaskView` shape guard added in LAI-126 (`serialises them on the wire shape,
not only in the row`) will not catch a semantic change here — it names fields,
not meanings. That is the right division, but it means this needs its own test.


---

## Submitted — CORE, 2026-09-02

**Option 2, as this file recommended: the latest completion, not cleared on a
reopen.** 1655 server green, lint and format clean.

### The code already did half of it, and that is the finding

`changeStatus` has always written `completedAt: now` on every arrival at `done`.
So the *behaviour* was option 2 before this task existed. **Nothing said so,
nothing tested it, and LAI-435's backfill had to step around it** — filling
nothing on a task that is not `done` now, specifically so as not to answer this
by accident.

An undecided decision that happens to be implemented correctly is still
undecided: the next person to touch that line has nothing telling them which of
the three answers it is, and two of them are one character away.

### The asymmetry is the part worth pinning

`started_at` keeps its **first** value; `completed_at` keeps its **latest**. That
is exactly what a reader assumes is a bug, so it is written at the site and
asserted in a test that checks **both on one journey** — `todo → in_progress →
review → done → in_progress → review → done` — because testing either alone
leaves the other looking arbitrary.

`started_at` answers *when did work begin*, and it did begin then: a task sent
back for rework did not start twice. `completed_at` answers *when did this last
reach done*, and a task done twice was completed the second time.

### The consequence, pinned rather than left to surprise somebody

**A reopened task carries a `completed_at` while it is not done.** That is a fact
about its history, not a claim about its state. `status` is the claim — and a
reader inferring completion from the timestamp is **already** wrong for a
`cancelled` task, which never had one.

### §6.4's text, for CHIEF

> **`started_at`** — when work first began: set the first time a task enters
> `in_progress` and never moved again. A task returned for rework did not start
> twice, and overwriting would shorten every cycle time computed from it.
>
> **`completed_at`** — when the task last reached `done`. Set on every arrival,
> and **not cleared** when a task is reopened: a task completed twice was
> completed the second time, and a reopened task keeps the record of having been
> finished before.
>
> **The two are deliberately asymmetric** — first for one, latest for the other.
> A `completed_at` on a task that is not `done` is a fact about its history;
> `status` is the only claim about its state.

Three mutations, all caught: keeping the first completion, clearing it on the way
out, and letting `started_at` take the latest so the asymmetry collapses.

---

## Accepted — CHIEF, 2026-09-02

**Accepted**, with §4.5's text applied — taken almost verbatim, including the
sentence that does the work: *a `completed_at` on a task that is not `done` is a
fact about its **history**; `status` is the only claim about its **state**.*

**Mutation-verified both rejected answers:**

| Mutation | Red |
| --- | --- |
| Clear it on leaving `done` (option 1) | `does not clear it while the task is reopened` + `serialises both on the wire` |
| Stamp only the first completion (option 3) | `keeps the latest completion, not the first` + `keeps started_at at its first value across the same journey` |

### An undecided decision that happens to be implemented correctly is still undecided

`changeStatus` has always written `completedAt: now` on every arrival, so the
**behaviour** was option 2 before this task existed. **Nothing said so, nothing
tested it, and LAI-435's backfill had to step around it** — filling nothing for a
task that is not `done` now, specifically to avoid answering by accident.

**That is the whole justification and it is a good one.** The next person to
touch that line had nothing telling them which of three answers it was, and two
of them are one character away: `task.completedAt === null`, or an `else` branch.
Both are now mutations that turn tests red.

### The asymmetry asserted on one journey

`todo → in_progress → review → done → in_progress → review → done`, with
`started_at` keeping its first value and `completed_at` its latest **in the same
test**. That is right: **the asymmetry is exactly what a reader assumes is a
bug**, and testing either half alone leaves the other looking arbitrary rather
than deliberate.
