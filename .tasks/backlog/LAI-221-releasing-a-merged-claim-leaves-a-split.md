---
id: LAI-221
title: Releasing a claim PM has already merged leaves master and the builder disagreeing
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-086
status: backlog
started:
finished:
---

## Goal

**Observed, not hypothetical.** CLAUDE.md §2 covers claiming and send-backs and
says nothing about a builder **releasing** a task that PM has already merged.

What happened:

1. I claimed LAI-086 — `git mv backlog → in-progress`, committed on `builder-b`.
2. PM merged `builder-b` into `master` for unrelated accepted work. The claim
   came with it, so **master now had LAI-086 at `.tasks/in-progress/`**.
3. A p1 regression appeared. I released LAI-086 unstarted — `git mv in-progress
   → backlog`, `assignee: unclaimed` — committed on `builder-b`.
4. State afterwards:

```
master     .tasks/in-progress/LAI-086-…   assignee: builder-b
builder-a  .tasks/backlog/LAI-086-…       assignee: unclaimed
builder-b  .tasks/backlog/LAI-086-…       assignee: unclaimed
```

**`master` is the branch §2 tells everyone to trust**, and it said the task was
claimed by a session that had let it go. It stayed that way until I re-claimed
it, which happened to restore the path master already had.

## Why it matters

The §2 claim check is `git log --all` over the three `.tasks/` directories, and
that check reports *"already claimed"* from the commit history regardless of
where the file currently sits. So during the window:

- another session running the check sees a claim and skips the task — it is
  invisible, not free
- if one had claimed it anyway from `master`'s state, two branches would hold
  the same task at different paths, and the merge is a rename-vs-rename conflict
  in the one place the protocol uses as a lock

It resolved itself here **only because the releasing session re-claimed it**.
Nothing in the protocol made that happen.

## Acceptance criteria

- [ ] CLAUDE.md §2 says what a builder does when releasing a task whose claim is
      already on `master`, and what PM does with the resulting state.
- [ ] The `git log --all` claim check in §2 and in `.claude/skills/` is either
      accurate for a released task, or it says plainly that a hit needs the
      current path checked before concluding the task is taken. Today the
      instruction is *"Any output means it is already claimed"* — which is
      wrong for a released one, and wrong in the direction that leaves work
      stranded.
- [ ] Whatever is decided, `git ls-tree -r master --name-only .tasks/` — the
      current state rather than the history — appears somewhere as the way to
      settle it.

## Notes

- The narrow fix might be "a release is only complete once PM merges it", making
  it PM's move rather than the builder's. That is a real cost: a builder cannot
  then hand work back without waiting.
- Or the claim check grows a second step: history says *look here*, current state
  says *is it actually taken*. Two commands instead of one, and it stays exact.
- PM asked for this to be filed and said the fix is theirs to write. Recorded
  here as observed, with no decision taken.
