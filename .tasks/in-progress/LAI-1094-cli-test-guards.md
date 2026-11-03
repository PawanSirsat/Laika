---
id: LAI-1094
title: 'cli tests: the exit-code drift test pins each section from its heading; tokenIn''s FIFO and closeSync guards fail fast'
area: cli
assignee: shell/belka
priority: p3
depends-on: [LAI-1091, LAI-1092]
discovered-from: LAI-1091
status: in-progress
started: 2026-11-03T06:29:17Z
---

## Why

Two reviews left non-blocking findings in tests that pass while missing what
they say they guard (CLAUDE.md §5: an assertion must be specific enough that a
broken setup cannot satisfy it).

1. **PR #244 (LAI-1091).** The exit-code drift test in
   `cli/test/project-check.test.ts` compares only from `first that applies:`
   to each section's end. A sentence contradicting the statement in a lead-in
   stays green: the comment's (`cli/src/project-check.ts` ~60-62, the `64 is
   EX_USAGE` part), the README's `Exit codes (LAI-1091; …)` lead-in, or the
   usage's `Exit: 0 current, 1 needs action…` summary line. The N2 sentence
   *"the check records with it"* also overstates: with `LAIKA_AGENT_TOKEN` and
   `LAIKA_AGENT_URL` and no project named the check only prints (exit 0), and
   with the board down it exits 2.
2. **PR #245 (LAI-1092).** (a) Removing `O_NONBLOCK` from `tokenIn`'s open in
   `cli/src/update.ts` is caught only by the CI job's 60-minute timeout: the
   open blocks the thread, so a node:test per-test timeout cannot fire.
   (b) No test catches a dropped `closeSync` in `tokenIn`.

## Acceptance criteria

- [ ] The drift test compares each place from its heading (`## Exit codes`,
      `Exit:`, `Exit codes (LAI-1091`) to its end, so a sentence added to any
      lead-in fails it; each place's own lead-in is pinned word for word.
- [ ] The N2 sentence says exactly what the code does, identically in the
      comment, the usage and the README, and a test pins the cases it names.
- [ ] Shown red on throwaway copies: a contradicting sentence in each of the
      three lead-ins (each edit anchor-checked as landed).
- [ ] The FIFO test runs a watchdog in a separate process that writes a marker
      and then opens the FIFO for writing after 10 s; after `run()` it asserts
      the marker does not exist (`tokenIn waited on the FIFO`), and kills the
      watchdog in `finally`.
- [ ] `swapAfterCheck` also wraps `closeSync`, and the swap test asserts that
      every fd opened on `polly.json` was closed (and that one was opened).
- [ ] Shown red on throwaway copies: `tokenIn` without `O_NONBLOCK` (red
      within about 10 s by the marker, not a timeout) and without `closeSync`.
- [ ] No production behaviour changes: `cli/src/` differs only in the
      exit-code statement's wording (comment and usage text).
- [ ] `cli` typecheck, lint and format of the touched files exit 0; the two
      test files pass one at a time with `--test-concurrency=1`; CI Gate green.

## Notes

Test-only batch (owner, 2026-11-01: batch small changes). Belka: one test
file at a time, never the full suite locally (CI runs the gate).
