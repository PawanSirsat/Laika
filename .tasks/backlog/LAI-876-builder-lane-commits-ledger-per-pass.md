---
id: LAI-876
title: 'Builder lane commits: made-here ledger kept per pass; lane filter tested'
area: cli
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-864
status: backlog
---

## Goal

A dispatched builder's commit only ever ticks the SIGNALS lane (LAI-314). It
never names a card on the person's block or counts in it, before or after a
sync, and its lane tick survives the builder's worktree being removed.

## What is there today (read at `9250fc3e`)

- `buildDraft` runs `draftCommits` twice: once over the person's repos, then
  over the dispatched builders' repos for the lane
  (`cli/src/activity-time.ts:1029-1044`). Both passes share one made-here
  ledger (`remembered`, `:1027`), and both add to it.
- **The ledger moves a builder's commit onto the person's block.** A builder
  in a separate clone commits `LAI-9 …` and pushes, and the person's repo
  fetches it. Before a sync: one lane tick, and block 09:00 untied. The sync
  writes the builder's commit to the ledger. On the next draft the person's
  pass finds it in `remembered` (`:982`) and takes it: `["09:00","LAI-9",1]`
  and `laneCommits` 0. That breaks LAI-314's *"name no task"*, and it changes
  blocks already sent.
- **Nothing tests the filter on the lane pass.** With the filter line
  (`:982`) deleted, `activity-time.test.ts` stays 41/41 green.
- **A lane tick is lost when the builder's worktree is removed.**
  `reposInScope` drops a path that no longer exists
  (`cli/src/activity-census.ts:690`), so `laneCommits` goes from 1 to 0. This
  predates LAI-864.

## Acceptance criteria

- [ ] **The ledger is kept per pass.** Each entry is tagged with the pass
      that wrote it, and the person's pass takes only its own.
- [ ] **Test: the repro above.** After the sync, the lane tick is still there
      and block 09:00 is still untied. Today it is `["09:00","LAI-9",1]` with
      `laneCommits` 0. Run it red first.
- [ ] **Test: the lane's own filter.** A builder clone's own commit ticks the
      lane, and a commit that clone only fetched does not. A mutation that
      skips the made-here filter on the lane pass alone turns this test red.
      Prove the mutation landed (a unique anchor and a `grep`), restore the
      file in a trap, and record the run here.
- [ ] **A lane tick survives removal.** The common git dir of a builder's
      worktree is recorded while the worktree lives. Test: after the
      worktree is removed, `laneCommits` stays 1. Today it drops to 0.
- [ ] **Nothing new leaves the machine.** The body's schema is unchanged.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **Files:** `cli/src/activity-time.ts`, `cli/src/activity-census.ts` (if
  the recorded git dir is read there), `cli/test/activity-time*.test.ts`. If
  the git dir has to be recorded at the builder's session start,
  `plugin/scripts/laika-activity-hook` and `cli/test/activity-hook.test.ts`
  too. The hook stays fork-free under zsh (LAI-859).
- An existing ledger has no tags. Say here what an untagged entry is read as,
  and why.
- **Privacy is unchanged** (D-088, D-096). The ledger and the recorded git
  dirs stay on the machine, 0600, and are never sent.
