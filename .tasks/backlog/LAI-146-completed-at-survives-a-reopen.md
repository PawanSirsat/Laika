---
id: LAI-146
title: completed_at survives a task leaving `done`
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-126]
discovered-from: LAI-126
status: backlog
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

- [ ] The behaviour is decided, implemented, and tested for
      `done → in_progress → done`.
- [ ] §6.4 says what each of the two timestamps means, including the asymmetry.
      **`docs/` is CHIEF's** — file that half.
- [ ] `started_at` keeps its LAI-126 behaviour: first entry, never overwritten.

## Notes / context

The `TaskView` shape guard added in LAI-126 (`serialises them on the wire shape,
not only in the row`) will not catch a semantic change here — it names fields,
not meanings. That is the right division, but it means this needs its own test.
