---
id: LAI-314
title: 'My day’s SIGNALS lane shows polly’s person-started turns as prompts, and dispatched builders’ commits as commits'
area: shell
assignee: strelka
priority: p1
depends-on: []
discovered-from:
started: 2026-10-21T19:14:50Z
status: review
finished: 2026-10-21T19:27:23Z
---

## Goal

The owner types only into Omnigent's polly, so the SIGNALS lane on My day is
always empty: only typed prompts and the person's own commits in repos the
hook saw a session start in get a five-minute bucket (D-096), and polly writes
neither. When this is finished the lane shows polly's person-started turns and
the commits of the builders the owner dispatched — as counts, nothing else —
without a minute of either reaching the owner's hours or contribution.

## The owner’s decision (2026-10-22), verbatim

> OWNER DECISION (2026-10-22, amends D-096 item 2 'only prompts and
> commits'): the owner types only into Omnigent's polly, so My day's SIGNALS
> lane is always empty. Make it show:
> (a) polly's PERSON-STARTED turns (the `t` turns the collector already
> distinguishes from turns Omnigent started itself) counted as prompts, for
> SIGNALS bucketing;
> (b) commits made in the repos/worktrees of builders the owner dispatched
> (sessions tagged `omnigent` in ~/.laika/activity/skip-sessions) counted as
> commits on the lane — lane ticks only, never added to the owner's hours or
> contribution (D-091 still holds for hours).
> Still counts only: no text, paths, repo names, messages.

Belka records the D-entry: LAI-316.

## Acceptance criteria

- [x] A turn the person started in an Omnigent-native orchestrator (`t`) is
      counted in its block's `signals.prompts` and timed in `at.prompts`; a
      turn Omnigent started (`w`) is not. A test, run red first.
- [x] At a dispatched builder's session start (`OMNIGENT=1` sub-agent, the
      skip line's `omnigent`), the hook records its repository top level in
      a separate local file, 0600, never sent — never in `repos`, so the
      heatmap census never counts it. A test, run red first.
- [x] The drafter counts the person's commits in those repos — not already
      counted from `repos` — in the block of the stretch they close, in
      `signals.commits` and `at.commits`; they make no minute, name no task,
      and move no minute between tasks. A test, run red first.
- [x] No text, path, repo name, branch or message leaves the machine: a block
      carries counts and buckets only, as before.
- [x] `laika activity status` no longer says *"Time drafting: not asked
      yet"* while drafts were sent (or the fix is filed).
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

- Prefer CLI + hook only; the server takes `at` already (D-096,
  `signalTimesOn`, `server/src/services/time-drafts.ts`).
- LAI-315 runs in parallel and edits `cli/src/activity-usage.ts` and server
  telemetry: do not edit `activity-usage.ts`.

## Builder notes (Strelka, at review)

- Gate criterion left unticked: root `pnpm test` exited 1 on LAI-304 alone
  (`server/test/services/sprints.test.ts` page-size timeout, load average
  ~18); that file alone passes (`pnpm exec vitest run
  test/services/sprints.test.ts`, exit 0, 43/43). `pnpm lint` 0,
  `pnpm format` 0. `cli` workspace: 565 test cases collected, 0 failed.
- The hook finds a dispatched builder's top level with builtins only (a
  `.git` walk-up) and appends; the sync prunes `dispatched-repos` and the
  drafter dedupes it — a dispatched start still forks nothing under zsh
  (D-095's contract test).
- A lane commit outside every stretch of the person's own activity is not
  shown: ticks live on blocks, and a block would add hours.
- Status-line cause: `startCollecting` (`laika activity on` again) dropped
  `drafting`/`drafting_checked_at`; now kept for the same board.
- Six older drafter expectations moved from `prompts: 0` to the
  person-started turns, as the decision requires.
