---
id: LAI-1019
title: 'Phase 6 live checkpoint on production: real GitHub verification, ref deletion, reverify, claim expiry and recovery offer (one device)'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-551
status: backlog
---

## Goal

The real-GitHub half of LAI-551 and of LAI-545's D-116 criteria (a)–(g) runs
for real on Belka, against production and `PawanSirsat/Laika`, and the result
is written down. **One device only**: this proves the checkpoint →
verification → recovery path end to end on one machine. It is **not** the
two-device demonstration, and the cross-device acceptance stays UNVERIFIED.

Board card LAIKA-873, under LAIKA-785.

## Acceptance criteria

- [ ] A sandbox card in `laika` is selected for and claimed by the agent this session runs as (`laika_whoami`), and consent to automatic checkpoints is turned on for that agent with the owner's password read from Keychain, never printed.
- [ ] In a temporary worktree on `LAI-1019-phase6-sandbox` (never `master`), `laika agent checkpoint save` is run and the times of push, tag push, registration and `verified` are recorded; if it stays pending past the 10-minute notice, the recovery tried is recorded with which one worked.
- [ ] The checkpoint tag is deleted on GitHub and the board's resulting state is recorded; a reverify at the same commit is run and its new tag's state recorded.
- [ ] The agent session is killed without ending it, and Connection lost → claim expiry → recovery offer is recorded (API is enough). No acceptance from another device.
- [ ] The sandbox branch and every tag this task created are deleted, and the sandbox card is left in Review or Cancelled, never Done.
- [ ] `docs/acceptance/LAI-1019-live-checkpoint.md` records what was proven, the timings, and what remains UNVERIFIED, including the tag ruleset status from `gh api repos/PawanSirsat/Laika/rulesets`.
- [ ] Real defects are filed as tasks with `discovered-from: LAI-1019`, not fixed.

## Notes / context

Docs-only. No test suites run locally (Belka resource rule). Commands,
timestamps and exit codes are recorded; tokens are never printed.
