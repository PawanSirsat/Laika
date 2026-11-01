---
id: LAI-1013
title: 'Timeline header test asserts a 600 ms wall-clock budget and flakes on a loaded CI runner'
area: shell
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-553
status: backlog
---

## What was seen

`server/web/test/routes/screens/timeline/timeline-derive.test.ts:255` —
*the widest drawable window steps by month and week, not by day* — asserts
`elapsed < 600` (line ~287: `the header took ${elapsed} ms`). On PR #165's
gate (run 41187417161, head `db18f6a4`, 2026-10-31T09:08Z) it failed with
**`the header took 729.0 ms`**. The combined branch's gate, started seven
seconds later on code that does not touch the timeline (run 41187425603,
`4ed52440`), passed. LAI-553 changes nothing under `server/web/src`.

## Why it is a flake

A wall-clock budget measured on a shared CI runner fails whenever the runner
is busy; it says nothing about the code. The same family as LAI-530 (a
deadline test flaking under load) and LAI-794.

## Goal

The test still catches the regression it exists for — a header that steps by
day over the widest window (~1,000–1,300 months) — without a wall-clock bound
a loaded machine can miss. For example: assert the work done (the number of
steps or labels produced, already checked as `months.length`) rather than
the time, or measure against a floor run beside it, as the CLI's prompt-hook
budget does (`≤ 2× its own floor`).

## Acceptance criteria

- [ ] The assertion no longer depends on absolute wall-clock time on the runner.
- [ ] A header that steps by day over the widest window still fails it (shown by a deliberate break).
- [ ] Repo-root gate exits 0.

## Role / machine

SHELL (`server/web/`). Filed by CORE (Belka) from CHIEF's block per CLAUDE.md §3; not fixed from LAI-553 because it is outside CORE's area.
