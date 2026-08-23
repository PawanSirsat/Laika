---
id: LAI-101
title: '`format:fix` cannot fix a file once it is committed'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-026]
discovered-from: LAI-005
status: backlog
---

## Goal

LAI-026 scoped `format:fix` to `git diff HEAD` plus untracked files, which is
exactly right for "fix what I am working on" and wrong the moment you commit:
the diff is then empty, `format:fix` does nothing, and `pnpm format` can be red
with no command that fixes it. Widen the window to the whole branch so the
formatter still reaches work this worktree has done but already committed.

## Acceptance criteria

- [ ] `format:fix` formats files changed anywhere on the current branch relative
      to its merge-base with `master`, plus uncommitted and untracked changes.
- [ ] It still never touches a file this worktree did not change — the LAI-026
      regression test must keep passing unchanged.
- [ ] Running it on a branch with no commits of its own (freshly branched from
      `master`) behaves like today: uncommitted and untracked files only.
- [ ] Running it on `master` itself does something sensible rather than
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
(D-017); PM grants it per task by name, so that grant has to be added here before
anyone starts.

No new dependencies.

---

## PM decision — 2026-08-24: grant added

**Scope exception granted to Builder-A.** This task authorises editing exactly:

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
