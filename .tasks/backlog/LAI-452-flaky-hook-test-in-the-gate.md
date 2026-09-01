---
id: LAI-452
title: '`unconfigured is silent, not broken` fails intermittently in the root gate'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-418]
discovered-from: LAI-158
status: backlog
---

## Goal

`cli/test/plugin-hooks.test.ts:184` — *"unconfigured is silent, not broken"* —
**failed once and passed on an immediate re-run**, same tree, no change:

```
run 1:  # pass 48  # fail 1   →  EXIT 1
run 2:  # pass 49  # fail 0   →  EXIT 0
```

`failureType: 'subtestsFailed'`, `2598ms`, with a
`WARN Local package.json exists, but node_modules missing` on the same run.

## Why this is p2 and not a shrug

**A flaky test in the gate is worse than a missing one.** The gate is the only
thing standing between a builder and a red `master`, and this repo spent a whole
day learning to read its exit code. **A test that is red once and green twice
teaches everybody to re-run instead of read** — and the next real failure gets
the same treatment.

CHIEF pushed on the red run, having not read it. `master` happened to be green
anyway. **That is the failure this task exists to prevent becoming normal.**

## Acceptance criteria

- [ ] **Reproduce it before fixing it.** Run the suite in a loop until it fails,
      and put the rate in the task — *"1 in 20"* is a different problem from
      *"1 in 2 under load"*, and the fix differs.
- [ ] The cause is named, not guessed at. The `node_modules missing` warning on
      the same run is a lead: **something in that test's environment is not what
      it assumes**, and a hook test that spawns a real session is the most likely
      place for a race between a spawn and a filesystem check.
- [ ] **No sleeps.** A timing fix that makes it rarer is this defect with a
      longer fuse. Wait on the condition, or make the condition unnecessary.
- [ ] The fixed test fails **deterministically** when the behaviour it names is
      broken — prove it with the same mutation LAI-418 used: point `LAIKA_URL`
      at nothing and require silence.
- [ ] Run it 50 times green before calling it fixed, and say so in the log.

## Notes / context

**Do not delete or skip it.** *"Unconfigured is silent"* is one of the two
criteria LAI-418 called most likely to be assumed rather than tested, and it is
the one that protects every repository that has never heard of Laika.

**It may be the harness rather than the assertion.** SHELL found in LAI-418 that
a stub closed on the last line of a test closes only when the test passes; a
similar shape here — a spawn whose teardown is conditional — would produce
exactly this.
