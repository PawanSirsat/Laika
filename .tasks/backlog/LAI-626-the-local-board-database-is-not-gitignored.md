---
id: LAI-626
title: .laika-local/ is untracked and unignored — a local board database one `git add -A` from being committed
area: docs
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-623
status: backlog
---

## What is wrong

`.laika-local/` sits in the repo root of a worktree and is **not** matched by
`.gitignore`:

```
$ git status --short .laika-local
?? .laika-local/

$ git check-ignore -v .laika-local     # no match
```

It holds a real SQLite board — `board-demo.db` plus its `-wal` and `-shm`, and
a `backups/` directory — created by the local-setup path the Connect work uses
for verification. Roughly 850KB today and growing.

## Why it matters

A board database holds users, projects, every task, and the **hash of every
personal access token ever minted against it**. A grep for `lai_` finds nothing
— tokens are hashed at rest, which is the system working — but it is still an
org's data, and it is one `git add -A` away from being public. CLAUDE.md §4
already forbids `git add -A` from the repo root for a different reason; this is
what it would sweep up.

It also means `git status` is never clean in a worktree that has run local
setup, which is the condition `format-fix`'s "does nothing on a clean worktree"
test is about.

## Acceptance criteria

- [ ] `.gitignore` matches `.laika-local/`.
- [ ] `git check-ignore -v .laika-local` reports the rule that matched — the
      check is that git agrees, not that a line was added.
- [ ] Whether anything under it was **ever committed** is checked, not assumed:
      `git log --all --name-only -- '.laika-local/**'` is empty. If it is not,
      that is a separate and more urgent task.

## Notes / context

- Repo-root config is CHIEF's by LAI-001, so SHELL filed rather than edited.
- Found while staging LAI-623: it showed up in `git status` next to the files
  being committed, which is exactly how it would get committed by accident.
