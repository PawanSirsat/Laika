---
id: LAI-1094
title: 'cli tests: the exit-code drift test pins each section from its heading; tokenIn''s FIFO and closeSync guards fail fast'
area: cli
assignee: shell/belka
priority: p3
depends-on: [LAI-1091, LAI-1092]
discovered-from: LAI-1091
status: review
started: 2026-11-03T06:29:17Z
finished: 2026-11-03T06:38:09Z
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

- [x] The drift test compares each place from its heading (`## Exit codes`,
      `Exit:`, `Exit codes (LAI-1091`) to its end, so a sentence added to any
      lead-in fails it; each place's own lead-in is pinned word for word.
- [x] The N2 sentence says exactly what the code does, identically in the
      comment, the usage and the README, and a test pins the cases it names.
- [x] Shown red on throwaway copies: a contradicting sentence in each of the
      three lead-ins (each edit anchor-checked as landed).
- [x] The FIFO test runs a watchdog in a separate process that writes a marker
      and then opens the FIFO for writing after 10 s; after `run()` it asserts
      the marker does not exist (`tokenIn waited on the FIFO`), and kills the
      watchdog in `finally`.
- [x] `swapAfterCheck` also wraps `closeSync`, and the swap test asserts that
      every fd opened on `polly.json` was closed (and that one was opened).
- [x] Shown red on throwaway copies: `tokenIn` without `O_NONBLOCK` (red
      within about 10 s by the marker, not a timeout) and without `closeSync`.
- [x] No production behaviour changes: `cli/src/` differs only in the
      exit-code statement's wording (comment and usage text).
- [x] `cli` typecheck, lint and format of the touched files exit 0; the two
      test files pass one at a time with `--test-concurrency=1`; CI Gate green.

## Notes

Test-only batch (owner, 2026-11-01: batch small changes). Belka: one test
file at a time, never the full suite locally (CI runs the gate).

## Result (shell/belka, 2026-11-03)

What changed, all in `cli/` (commit `test(cli): … [LAI-1094]`):

- `cli/test/project-check.test.ts` — the drift test compares each place from
  its heading: `leadIn.comment`, `leadIn.usage`, `leadIn.readme` pin the text
  before `first that applies:` word for word, and the statement after it as
  before. New test *"LAIKA_AGENT_TOKEN with LAIKA_AGENT_URL: every other rule
  applies to it"*: several tools saved, the environment's credential decides;
  no project named → 0 and nothing sent, with `--harness` → 2; manifest down,
  a 401, and a board too old (404) → 2 each, said in words.
- `cli/src/project-check.ts` (comment and `USAGE`) and `cli/README.md` — the
  N2 sentence, identically: *"… and it wins over the several-tools rule. Every
  other rule above applies to it as written: no project named only prints, or
  is 2 with --harness; a board that does not answer, refuses, or is too old to
  take it is 2."* No code changed.
- `cli/test/update.test.ts` — `swapAfterCheck` wraps `closeSync` and returns
  `opens()` and `unclosed()`; the swap test asserts one was opened and none
  is left open. The FIFO test spawns `sh -c 'sleep 10; : > "$1"; : > "$0"'`
  with the FIFO and a marker, asserts `!existsSync(marker)` (*tokenIn waited
  on the FIFO*) right after `run()`, and kills the watchdog in `finally`.

Mutations, each on a throwaway copy under the session scratchpad (the
worktree never edited), each edit anchor-checked (found once, new text
present, sha256 changed). *Before* = the tests at `eee6c4d9`; *after* = this
branch.

| mutant | before | after |
| --- | --- | --- |
| comment lead-in: *"A board that is down gives `0`."* | green (59/59) | red: `comment gives its heading, its lead-in …` |
| README lead-in: *"; a board that is down gives `0`"* | green (59/59) | red: `readme gives its heading, its lead-in …` |
| usage summary: *"A board that is down gives 0."* | green (59/59) | red: `usage gives its heading, its lead-in …` |
| `tokenIn` without `O_NONBLOCK` | hung, killed at 45 s | red in 11.6 s: `tokenIn waited on the FIFO` |
| `tokenIn` without `closeSync` | green (1/1) | red in 1.6 s: `a descriptor opened on polly.json was never closed` |

A first usage mutant (*"0 current or board down"*) also reddened the older
`usage errors are 64` test, whose regex already pins the summary's words; it
was re-aimed to add a sentence instead, so it isolates the gap.

Gate, local, Belka (one file at a time, `--test-concurrency=1`):
`cli` typecheck 0; `node --test --test-concurrency=1 test/project-check.test.ts`
0 (60 tests); `node --test --test-concurrency=1 test/update.test.ts` 0 (67
tests); eslint and prettier `--check` on the four touched files 0. The full
repo gate runs in CI on the PR.
