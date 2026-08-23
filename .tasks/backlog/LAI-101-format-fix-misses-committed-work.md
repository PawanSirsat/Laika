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
