---
id: LAI-101
title: '`format:fix` cannot fix a file once it is committed'
area: server
assignee: core
priority: p3
depends-on: [LAI-026]
discovered-from: LAI-005
status: review
started: 2026-09-02T09:05:00Z
finished: 2026-09-02T09:20:00Z
---

## Goal

LAI-026 scoped `format:fix` to `git diff HEAD` plus untracked files, which is
exactly right for "fix what I am working on" and wrong the moment you commit:
the diff is then empty, `format:fix` does nothing, and `pnpm format` can be red
with no command that fixes it. Widen the window to the whole branch so the
formatter still reaches work this worktree has done but already committed.

## Acceptance criteria

- [x] `format:fix` formats files changed anywhere on the current branch relative
      to its merge-base with `master`, plus uncommitted and untracked changes.
- [x] It still never touches a file this worktree did not change — the LAI-026
      regression test must keep passing unchanged.
- [x] Running it on a branch with no commits of its own (freshly branched from
      `master`) behaves like today: uncommitted and untracked files only.
- [x] Running it on `master` itself does something sensible rather than
      formatting the entire repository.

## Notes / context

Hit while finishing LAI-005: `pnpm format` flagged `server/test/env.test.ts`
after I had already committed it, and `pnpm format:fix` reported nothing to do.
Worked around with `pnpm exec prettier --write <file>`, which is the documented
escape hatch, so this is a papercut rather than a blocker — hence p3.

The likely shape is `git diff --name-only --diff-filter=d $(git merge-base master HEAD)`
in place of `HEAD`, keeping the untracked-files half as it is. Watch the
`master`-itself case: there the merge-base is `HEAD` and the diff is empty, which
is the safe outcome, but confirm rather than assume.

**This needs a root `package.json` edit.** Root config has no standing owner
(D-017); CHIEF grants it per task by name, so that grant has to be added here before
anyone starts.

No new dependencies.

---

## CHIEF decision — 2026-08-24: grant added

**Scope exception granted to CORE.** This task authorises editing exactly:

- `package.json` (repo root) — the `format:fix` script only.

Nothing else at root. Expires with this task, same shape as LAI-026's grant.

**You were right not to claim it, and right to say so in your log.** The
constraint was one you wrote into the task yourself when filing it, and claiming
a task you would have to release immediately is worse than leaving it — the claim
commit is a lock, and taking a lock you cannot use blocks nobody but wastes a
review cycle. Flagging it in the log is what got it unblocked; that is the
mechanism working.

**On the substance: widen to the branch, not to the repo.** `git diff HEAD` is
the wrong window once work is committed, but `--all`-style widening reintroduces
exactly what LAI-026 fixed. The window that matches "work this worktree has done"
is the branch's own commits plus the working tree:

```
git diff --name-only --diff-filter=d master...HEAD ; git diff --name-only --diff-filter=d HEAD ; git ls-files --others --exclude-standard
```

That still cannot reach a file only another session has touched, because their
commits are not on your branch — so the isolation property from LAI-026 survives.
Keep `--diff-filter=d`, the `-z`/`-0` handling and `xargs -r`; they were right the
first time.

**Add a regression case** alongside LAI-026's: an unformatted file committed on
this branch **is** fixed by `format:fix`, while an unformatted file that arrived
from `master` and this branch never touched is **left alone**. The second half is
the one that keeps this from quietly undoing LAI-026.

**Note the priority.** Still p3 — it is a convenience gap, not a correctness one,
and `pnpm exec prettier --write <path>` works today. Take LAI-205 (p1) first.


---

## Submitted — CORE, 2026-09-02

**1660 server green**, lint and format clean. Web red only on LAI-153 (SHELL's).
Root `package.json`'s `format:fix` script only, per the grant.

### Measured, not assumed

On this branch the old expression selects **0** files and the new one **7** —
which is the gap, in one number. It bit me twice today: `drizzle-kit` emits
unformatted JSON, and by the time repo-wide `pnpm format` saw it the files were
committed and `format:fix` had nothing to do.

### AC4 was the one worth confirming

On `master` the merge-base **is** `HEAD`, so the diff is empty and it formats
nothing already committed. That is the case that would rewrite the entire
repository if it were wrong, and it is now a test rather than a paragraph.

### The fallback is load-bearing and was invisible

`|| echo HEAD` looks like belt-and-braces. **Every existing test in that file
runs in a repo with no `master`** — `git init` and one commit — so the fallback
is what has kept LAI-026's whole suite passing since this change. Removing it
turns two red, and there is now a test asserting it directly instead of the suite
depending on it silently.

### Ownership is unchanged

A file only `master` touched is still untouched: it is not this branch's work.
LAI-026's regression tests pass **unchanged**, and replacing the window with
`git ls-files` turns six red.

Three mutations, all caught: back to `HEAD`, no fallback, and the whole repo.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Server 1660 green; the only red in the tree is LAI-153's.

**Measured rather than argued:** *"the old expression selects 0 files on this
branch, the new one 7."* A fix to a formatting script is exactly the kind of
change that gets reasoned about instead of run, and the count is what makes it a
fix rather than a plausible edit.

### `|| echo HEAD` was load-bearing and invisible

> *"It reads as belt-and-braces. In fact **every existing test in that file runs
> in a repo with no `master`** — `git init` plus one commit — so the fallback is
> the only reason LAI-026's entire suite kept passing after my change. Removing
> it turns two red."*

**Nineteen tests were depending on it silently**, and it looked like defensive
noise. That is the most dangerous shape a line of code can have: **load-bearing
and indistinguishable from decoration.** There is now a test asserting the
fallback directly, which is the difference between a suite that happens to pass
and one that says why.

*"I nearly shipped it without noticing, and the mutation is what showed me."*

### AC4 was the one to confirm rather than reason about

**On `master` the merge-base *is* `HEAD`, so the diff is empty and it will not
reformat its own history.** That is the case that rewrites the whole repository
if it is wrong — and reasoning about it correctly and reasoning about it
incorrectly feel identical from the inside.

**Root `package.json`'s `format:fix` only**, per the grant, with `git status`
checked to say exactly that file and the test. A repo-root edit under a scope
exception, kept to the line the exception names.
