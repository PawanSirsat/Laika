---
id: LAI-452
title: '`unconfigured is silent, not broken` fails intermittently in the root gate'
area: cli
assignee: shell
priority: p2
depends-on: [LAI-418]
discovered-from: LAI-158
started: 2026-09-09T18:21:07+05:30
finished: 2026-09-09T22:55:01+05:30
status: review
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

- [x] **Reproduce it before fixing it.** Run the suite in a loop until it fails,
      and put the rate in the task — *"1 in 20"* is a different problem from
      *"1 in 2 under load"*, and the fix differs.
- [x] The cause is named, not guessed at. The `node_modules missing` warning on
      the same run is a lead: **something in that test's environment is not what
      it assumes**, and a hook test that spawns a real session is the most likely
      place for a race between a spawn and a filesystem check.
- [x] **No sleeps.** A timing fix that makes it rarer is this defect with a
      longer fuse. Wait on the condition, or make the condition unnecessary.
- [x] The fixed test fails **deterministically** when the behaviour it names is
      broken — prove it with the same mutation LAI-418 used: point `LAIKA_URL`
      at nothing and require silence.
- [x] Run it 50 times green before calling it fixed, and say so in the log.

## Notes / context

**Do not delete or skip it.** *"Unconfigured is silent"* is one of the two
criteria LAI-418 called most likely to be assumed rather than tested, and it is
the one that protects every repository that has never heard of Laika.

**It may be the harness rather than the assertion.** SHELL found in LAI-418 that
a stub closed on the last line of a test closes only when the test passes; a
similar shape here — a spawn whose teardown is conditional — would produce
exactly this.


---

## Submitted — SHELL

Root gate `EXIT 0` — 1865 server, 644 web, **72** cli.

### Reproduced first, and it was not the test this task names

| | failures |
| --- | --- |
| the file alone, 30 runs | **0** |
| under 20 spinners on 10 cores, ~13 runs | **1** |

And the one that failed was **`the token stays out of argv`**, not *"unconfigured
is silent"*. Same file, different test, **identical assertion** —
`assert.equal(run.code, 0)`.

### The cause, and it explains both

`execFile` reports a **failure to start** the process through the same callback
as a non-zero exit, with `error.code` a *string* errno. The harness mapped
anything non-numeric to `1`:

```ts
const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
```

So a spawn failure arrived as **`code: 1`, stdout `''`, stderr `''`** — byte for
byte what a hook exiting 1 silently looks like. **Measured directly** rather than
inferred: spawning a path that does not exist yields `ENOENT` and maps to exactly
that. Under load the same shape arrives as `EAGAIN`.

**Which test loses is whichever was running when the machine could not fork.**
That is why the report named one and reproducing it produced another, and it is
the whole reason this looked like a race in one assertion.

### Two things the measurement retired

**The 20s `execFile` timeout is gone.** The hook runs in **109–125ms under 20
spinners** — the bound could only ever turn a slow machine into a failed
assertion, never protect anything. `node --test`'s own timeout still catches a
genuine hang, and a hang there is worth surfacing rather than hiding.

**The `node_modules missing` warning was a red herring**, and the task named it
as a lead. `cli/node_modules` does not exist because pnpm hoists to the root, so
that warning prints on **every** run in this package. It was on the failing run
because it is on all of them.

### The fix, against AC3

`Run` now distinguishes *"the hook exited N"* from *"it never ran"*, and a
transient **failure to start** is retried immediately — bounded, **no sleep, and
nothing given more time**. A machine that cannot fork right now is not a fact
about the hook, so this is *making the condition unnecessary* rather than waiting
it out. `ENOENT` is **not** retried and surfaces as itself:

```
the hook could not be started (ENOENT). This is the machine, not the hook —
reporting it as an exit code is what LAI-452 was filed on.
```

### AC4 — deterministic, three times each

| mutation | result |
| --- | --- |
| unconfigured stops being silent | **RED ×3** |
| unconfigured stops exiting 0 | **RED ×3** |
| half-configured posts anyway | **RED ×3** |

### AC5 — 50 runs, and the first soak was wrong

**0 assertion failures and 0 incomplete runs in 50**, with **24 spinners verified
alive throughout** and load average ~127.

**An earlier soak reported 3 failures in 50 and I am not hiding it.** Its check
was `grep -q "^# fail 0"`, which counts a run that never produced a summary as an
assertion failure, and it captured no detail — so it could not say which had
happened. The re-run separates the two, captures every failure, and confirms the
load was present. **A soak whose failure detection conflates two outcomes is the
same defect this task is about**, one level up.
