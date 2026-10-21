---
id: LAI-314
title: 'My day’s SIGNALS lane shows polly’s person-started turns as prompts, and dispatched builders’ commits as commits'
area: shell
assignee: strelka
priority: p1
depends-on: []
discovered-from:
started: 2026-10-21T19:14:50Z
status: in-progress
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

- [ ] A turn the person started in an Omnigent-native orchestrator (`t`) is
      counted in its block's `signals.prompts` and timed in `at.prompts`; a
      turn Omnigent started (`w`) is not. A test, run red first.
- [ ] At a dispatched builder's session start (`OMNIGENT=1` sub-agent, the
      skip line's `omnigent`), the hook records its repository top level in
      a separate local file, 0600, never sent — never in `repos`, so the
      heatmap census never counts it. A test, run red first.
- [ ] The drafter counts the person's commits in those repos — not already
      counted from `repos` — in the block of the stretch they close, in
      `signals.commits` and `at.commits`; they make no minute, name no task,
      and move no minute between tasks. A test, run red first.
- [ ] No text, path, repo name, branch or message leaves the machine: a block
      carries counts and buckets only, as before.
- [ ] `laika activity status` no longer says *"Time drafting: not asked
      yet"* while drafts were sent (or the fix is filed).
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

- Prefer CLI + hook only; the server takes `at` already (D-096,
  `signalTimesOn`, `server/src/services/time-drafts.ts`).
- LAI-315 runs in parallel and edits `cli/src/activity-usage.ts` and server
  telemetry: do not edit `activity-usage.ts`.
