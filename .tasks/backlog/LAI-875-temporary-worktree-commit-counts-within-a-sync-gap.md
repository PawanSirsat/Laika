---
id: LAI-875
title: 'Made-here: a commit from a temporary worktree removed within one sync gap still counts'
area: cli
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-864
status: backlog
---

## Owner decision PENDING — do not build yet

On 2026-10-22 the owner was asked whether to accept this loss or fix it. **Do
not start until the owner's answer is recorded on the card and in this
file.** If the owner accepts the loss, this task closes with their words
quoted here and no code.

## Goal

A commit made in a temporary worktree still counts as made here when the
worktree is merged and removed before the next sync. CLAUDE.md §4.2's own
flow does exactly this: commit, merge, push and remove, in one sitting.

## What is there today (read at `9250fc3e`)

- LAI-864 knows a commit was made here from the reflogs, plus a ledger
  (`~/.laika/activity/made-here`) that a sync writes. `git worktree remove`
  and `git branch -d` delete the reflogs that named the commit.
- The ledger is written only during a sync. Syncs run only on a Claude Code
  `Stop`, at most every 600 s (`min_sync_interval_s`). So a commit made,
  merged and cleaned up inside one gap is lost: it neither ties nor counts.
- `cli/test/activity-time-made-here.test.ts:257`, *"the loss: cleaned up
  before any draft ran"*, encodes that loss. It shipped without the owner's
  word, against LAI-864's review note B3: *"A loss ships only with their
  word, recorded here."*

## Acceptance criteria

- [ ] **The owner's answer** is recorded on the card and quoted here before
      any code is written.
- [ ] **If the answer is to fix it:** the worktree-removed-within-the-gap
      case counts 1. Today it counts 0 (`:257`). The test is changed to
      assert the count, and it is run red first.
- [ ] **The positive halves stay green.** *"a sync drafted while the
      worktree lived"* and LAI-864's fetched, merged and pulled tests pass
      unedited.
- [ ] **Nothing new leaves the machine.** The body's schema is unchanged.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`), once the owner
  answers.
- **Belka's recommended fix:** record the made-here commit hashes locally at
  every Claude Code `Stop`, with no network, not only during a sync.
- **The hook stays fork-free** where it is fork-free today under zsh
  (LAI-859's fork-refused test). If recording needs `git`, it runs in the
  CLI, not in the hook's fork-free path.
- **Files:** `cli/src/activity-time.ts`, any new `cli/src/activity-*.ts`
  helper, `cli/test/activity-time*.test.ts`, `cli/README.md` (the *Made on
  this machine* paragraph, `:405-412`), and, only if the hook must change,
  `plugin/scripts/laika-activity-hook` and `cli/test/activity-hook.test.ts`.
  No new dependencies.
- **Privacy is unchanged** (D-088, D-096). Hashes are kept on the machine,
  0600, and never sent.
