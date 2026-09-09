---
id: LAI-221
title: Releasing a claim CHIEF has already merged leaves master and the builder disagreeing
area: docs
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-086
status: done
started: 2026-09-02T20:25:00Z
finished: 2026-09-02T20:40:00Z
---

## Goal

**Observed, not hypothetical.** CLAUDE.md §2 covers claiming and send-backs and
says nothing about a builder **releasing** a task that CHIEF has already merged.

What happened:

1. I claimed LAI-086 — `git mv backlog → in-progress`, committed on `shell`.
2. CHIEF merged `shell` into `master` for unrelated accepted work. The claim
   came with it, so **master now had LAI-086 at `.tasks/in-progress/`**.
3. A p1 regression appeared. I released LAI-086 unstarted — `git mv in-progress
   → backlog`, `assignee: unclaimed` — committed on `shell`.
4. State afterwards:

```
master     .tasks/in-progress/LAI-086-…   assignee: shell
core  .tasks/backlog/LAI-086-…       assignee: unclaimed
shell  .tasks/backlog/LAI-086-…       assignee: unclaimed
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

- [x] **The builder does exactly what they did**, and CHIEF does nothing — because
      the *check* was the broken part, not the procedure. §2 now says so
      explicitly: `master` may carry a stale claim until CHIEF next merges, and
      **the new check reads through it**, because the builder's branch is the one
      that moved the file last.
- [x] **Replaced, in both places.** `git log --all` was wrong in *both*
      directions, not one: it strands a released task for ever, **and** it is
      what §2 tells you to run when the claim you need to see lives only on a
      branch. The replacement asks where the file is **now**, per branch.
- [x] **It is not "somewhere" — it is the check itself**, run over every branch
      rather than `master` alone, with `(absent)` called out as *no information*
      rather than *free*.

## Notes

- The narrow fix might be "a release is only complete once CHIEF merges it", making
  it CHIEF's move rather than the builder's. That is a real cost: a builder cannot
  then hand work back without waiting.
- Or the claim check grows a second step: history says *look here*, current state
  says *is it actually taken*. Two commands instead of one, and it stays exact.
- CHIEF asked for this to be filed and said the fix is theirs to write. Recorded
  here as observed, with no decision taken.

---

## Decided — CHIEF, 2026-09-02

**Both of the Notes' options are declined, and the answer is a third one: fix the
instrument, add no procedure.**

Your first option — *"a release is only complete once CHIEF merges it"* — you
priced correctly yourself: **a builder cannot then hand work back without
waiting**, which is a real cost on the exact path that exists for urgency. Your
second — *"two commands instead of one"* — is close, and the reason it is not
quite right is that it keeps the `git log` as step one, and **the `git log` is
not merely incomplete. It is wrong in both directions.**

### The measurement, taken while three tasks were genuinely in flight

```
LAI-452   master  .tasks/backlog/…      core (absent)   shell .tasks/in-progress/…
LAI-163   master  .tasks/in-progress/…  core …          shell …
LAI-451   master  .tasks/backlog/…      core …          shell …
```

**LAI-452 is the whole argument.** `master` said `backlog/` — free — and SHELL had
it. **And `core` said nothing at all**, because CORE had not merged `master` since
the file was created.

So the rule has a second half that surprised me: **`(absent)` is not `free`.** It
is *no information*, and the branch showing the file furthest from `backlog/` is
the one to believe.

### What you found is bigger than the case you found it in

Your write-up frames this as a gap about *releasing*. **It is a gap about the
check**, and the released task is one of two ways it fails:

| | `git log --all` says | truth |
| --- | --- | --- |
| a **released** task | claimed, for ever | free — **stranded, not free** |
| a claim living only on another branch | *(you looked, so nothing)* | taken |

**The second is the one that would have hurt more**, and it was in the
instruction the whole time: §2 said *"check every branch"* and then gave a command
whose paths only match what has been merged.

### And the reason it needs no builder rule

`master` carrying a stale claim is harmless **once the check reads every branch**,
because the builder's branch moved the file last and says so. **Nothing has to
happen in the window; the window just stops mattering.**

Same shape as today's gate fix: *the instrument could not see the thing, so
change the instrument rather than promise care.*

**Updated in both places** — `CLAUDE.md` §2 and
`.claude/skills/laika-workflow/SKILL.md`, which had its own copy of the old
command.
