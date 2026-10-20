---
id: LAI-815
title: 'Tokens spent by Omnigent sub-agents never reach the board: D-086''s skip drops them from org and project totals, not only from the person''s'
area: cli
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-769
status: in-progress
started: 2026-10-20T12:19:23Z
---

## Goal

A project's token consumption includes the work agents did on it, whoever
dispatched them, while a person's own figures stay theirs (D-086, D-088
item 9). **Needs the owner's decision before it is claimed. See "Decision".**

## Found (explore-project-token-usage, 2026-10-20, verified)

- The hook marks an Omnigent-launched sub-agent session as automated
  (`plugin/scripts/laika-activity-hook:149-166`, written to `skip-sessions`
  at `:283`). The collector then drops **every record of that session**
  (`cli/src/activity-usage.ts:2067`, `:2258`). It is never sent, not even as
  unattributed.
- **Since 2026-10-16: 23.47M headline tokens dropped from the Laika checkout,
  14.26M of them on 10-20.** The board's org total of 12,126,098 matches what
  this Mac sent.
- D-086 item 1 says the skip exists so that an orchestrator's builders do not
  inflate **that person's** tokens. The code also removes them from the org
  and project totals. LAI-769's goal was *"how many tokens the team's agents
  consume … per project"*.
- **Lifting the skip alone ties only 3.01M of the 23.47M to `laika`.** That
  share comes from sub-agents that called `start_working`. The rest has no
  mark, and its branch has no key: the agent's working directory is the main
  checkout on `master`, even when it works in a `LAI-NNN-…` worktree. That is
  the attribution half below.
- polly itself writes no transcript (`--no-session-persistence`, per the
  hook's comment), so its own tokens are invisible either way.

## Decision (owner)

1. Do sub-agent tokens count toward the **org and project** totals, while
   staying out of `by_developer` and the person's card? This amends D-086.
2. Attribution. **Either** CHIEF requires every dispatched builder to call
   `start_working LAI-NNN` with its branch, which needs no code, **or** the
   collector also reads a key from the worktree's branch.
3. polly's own spend: count it, through telemetry or a persisted session, or
   leave it out.

## Acceptance criteria (once decided)

- [ ] The collector sends a skipped session's rows with an `automated` flag
      (a migration for the new column) instead of dropping them.
- [ ] The server includes those rows in the org, project and task totals,
      and excludes them from `by_developer`, the person's usage card and any
      per-person figure. Tests cover both sides.
- [ ] A D-086 amendment is recorded in docs/DECISIONS.md, and SPEC is updated
      where it describes the skip.
- [ ] A replay of this Mac's 10-20 logs, in a scratch HOME (never the real
      `~/.laika`), shows the sub-agent tokens arriving in the org total and
      the `start_working`-marked share arriving in `laika`.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Decided (CHIEF, 2026-10-20, before any claim)

The owner said *"yes start the LAI 815"* to the three questions above. They
are recorded as **D-091**: count automated tokens for the organisation, the
space and the task, never for the person; builders mark their card; polly's
own tokens are out for now. D-091 is the contract.
