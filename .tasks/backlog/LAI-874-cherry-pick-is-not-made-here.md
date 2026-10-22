---
id: LAI-874
title: 'Made-here: a cherry-pick is not made here; one tested step parser'
area: cli
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-864
status: backlog
---

## Goal

A cherry-pick is not a commit made on this laptop. It copies its source's
author and author time, so counting it either brings another laptop's commit
in, at that laptop's time, or counts this laptop's own commit twice. LAI-864's
review note B2 says so. Which reflog entries count is decided in one exported
function with a unit table.

## What is there today (read at `9250fc3e`)

- `MADE_HERE` (`cli/src/activity-time.ts:864-865`) matches `cherry-pick`
  outright. Its `commit(?: \([a-z-]+\))?` branch also matches
  `commit (cherry-pick)`, which is what a conflicted cherry-pick finished by
  `git commit` writes.
- The docs say the same in three places: the header (`:37-38`, *"made here
  when a reflog says a commit, amend, cherry-pick or rebase wrote it"*), the
  comment above `MADE_HERE` (`:860`), and `cli/README.md:407`.
- **Impact.** Another laptop's cherry-picked commit names a card here. A
  cherry-pick of your own commit onto a second branch counts twice.

## Acceptance criteria

- [ ] **One step parser, exported,** with a unit table that asserts each of
      these:
      - false: `cherry-pick: x`, `commit (cherry-pick): x` and
        `pull -q (finish): …`;
      - true: `pull -q (pick): x`, `pull (pick): x`, `pull --rebase (pick): x`,
        `rebase -i (reword): x`, `rebase (continue): x` and
        `commit (amend): x`.
- [ ] **Test (real git): another laptop's commit.** A cherry-picks B's
      `LAI-9 …`. A's block is untied, with 0 commits. Today it ties LAI-9 and
      counts 1.
- [ ] **Test (real git): your own commit, twice.** A cherry-picks its own
      commit onto a second branch. It counts 1. Today it counts 2.
- [ ] **Test (real git): a conflicted cherry-pick.** Finished by
      `git commit`, and again by `git cherry-pick --continue`, it is not
      counted. Today it is.
- [ ] **The positive guards stay green.** LAI-864's tests for a commit, an
      amend, a pull that rebases and a resolved `(continue)` pass unedited.
- [ ] **`git am` is decided explicitly** and recorded here, with a test
      either way. It keeps the patch's author time, as cherry-pick does.
- [ ] **The docs.** `activity-time.ts:37-38`, `:860` and `cli/README.md:407`
      no longer say cherry-pick is made here.
- [ ] **LAI-864's B2 boxes are ticked.** Each box names the test that meets
      it. A box nothing meets stays unticked and says so.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **A shape that works:** `commit(?: \((?!cherry-pick)[a-z-]+\))?`.
- **Files:** `cli/src/activity-time.ts`, `cli/test/activity-time*.test.ts`,
  `cli/README.md`, and LAI-864's task file, for its B2 ticks only.
- Read the step in brackets, not the command (LAI-864, B2): `pull (pick):`
  and `pull -q (pick):` are what a plain `git pull` writes under
  `pull.rebase=true`.
