---
id: LAI-1019
title: 'Phase 6 live checkpoint on production: real GitHub verification, ref deletion, reverify, claim expiry and recovery offer (one device)'
area: docs
assignee: polly
priority: p1
depends-on: []
discovered-from: LAI-551
status: review
started: 2026-11-01T07:31:15Z
finished: 2026-11-01T16:15:48Z
---

## Goal

The real-GitHub half of LAI-551 and of LAI-545's D-116 criteria (a)–(g) runs
for real on Belka, against production and `PawanSirsat/Laika`, and the result
is written down. **One device only**: this proves the checkpoint →
verification → recovery path end to end on one machine. It is **not** the
two-device demonstration, and the cross-device acceptance stays UNVERIFIED.

Board card LAIKA-873, under LAIKA-785.

## Acceptance criteria

- [x] A sandbox card in `laika` is selected for and claimed by the agent this session runs as (`laika_whoami`), and consent to automatic checkpoints is turned on for that agent with the owner's password read from Keychain, never printed.
- [x] In a temporary worktree on `LAI-1019-phase6-sandbox` (never `master`), `laika agent checkpoint save` is run and the times of push, tag push, registration and `verified` are recorded; if it stays pending past the 10-minute notice, the recovery tried is recorded with which one worked.
- [x] The checkpoint tag is deleted on GitHub and the board's resulting state is recorded; a reverify at the same commit is run and its new tag's state recorded.
- [x] The agent session is killed without ending it, and Connection lost → claim expiry → recovery offer is recorded (API is enough). No acceptance from another device.
- [ ] The sandbox branch and every tag this task created are deleted, and the sandbox card is left in Review or Cancelled, never Done.
- [x] `docs/acceptance/LAI-1019-live-checkpoint.md` records what was proven, the timings, and what remains UNVERIFIED, including the tag ruleset status from `gh api repos/PawanSirsat/Laika/rulesets`.
- [x] Real defects are filed as tasks with `discovered-from: LAI-1019`, not fixed.

## Notes / context

Docs-only. No test suites run locally (Belka resource rule). Commands,
timestamps and exit codes are recorded; tokens are never printed.

## Delivered

Record: `docs/acceptance/LAI-1019-live-checkpoint.md`. Polly · Belka, one
device, production and `PawanSirsat/Laika`, 2026-11-01. Board LAIKA-873;
sandbox LAIKA-875 (Cancelled).

Every step passed single-device: save → verified in 0.37 s from GitHub's tag
delivery; tag delete → `ref_deleted` within the delivery's request; reverify
→ `-r1` verified 0.65 s after the command; kill → `suspect` +75 s → expiry
and recovery offer +306.8 s. Two-device acceptance (LAI-551) is UNVERIFIED.

**One criterion left open: cleanup.** The re-tag `…-r1` and the sandbox
branch `LAI-1019-phase6-sandbox` still exist on `origin` (and the branch
locally). This session's blast-radius hook refuses remote deletes, so the
exact commands are in the record's §4 for the owner. Everything else this
task created is removed.

Filed: LAI-1034 (LAIKA-890), a Polly session's checkpoint cannot push.
No tests were run (Belka resource rule; docs-only).
