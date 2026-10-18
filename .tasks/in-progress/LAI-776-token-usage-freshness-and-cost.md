---
id: LAI-776
title: 'Token usage: data arrives only at session start or end, and a sync with new bytes rewrites 4.6 MB'
area: cli
assignee: owner-direct
priority: p3
depends-on: []
discovered-from: LAI-769
status: in-progress
started: 2026-10-18T03:46:13Z
---

## Goal

Two measured costs LAI-769 left as they are:

1. **Freshness.** The usage step runs inside `laika activity sync`, which the
   hooks start on session start and end when due. A session that runs for
   hours reports its tokens only when it ends. REPORT.md §1b suggests a
   throttled `Stop` trigger (Claude Code), which fires every turn; the hook
   would only launch the detached sync when `next_sync_at` has passed.
2. **The step with something new** costs about 90 ms on the measured machine
   (785 transcripts): it parses and rewrites `usage-data.json`, 4.6 MB holding
   every reply of the 31-day window by message id. The step with nothing new is
   17–19 ms in a fresh process and is not the problem.

## Acceptance criteria

- [ ] Tokens from a running session reach the board within one sync interval,
      with no work on the prompt path (the hook stays fork-free under zsh).
- [ ] A sync with new bytes in one transcript costs under 50 ms, measured on a
      machine with ~800 transcripts, and the dedupe across files still holds.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
