---
id: LAI-1091
title: 'Project check follow-ups from PR #241: a fold never outlives a declined block, exit codes stated precisely, --harness that cannot record exits 2 whatever the order, and no check command for a tool the CLI refuses'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
discovered-from: LAI-1090
status: review
started: 2026-11-02T19:05:00+05:30
finished: 2026-11-02T19:18:58+05:30
---

## Why

Small follow-ups from the review of PR #241 (LAI-1090, merged as
`98cc8908`). They were non-blocking there and ship together in one PR.

1. **A fold can outlive the block it folds into.** In V3's
   `projectSetupPrompt` (`server/web/src/routes/screens/connect/connect-copy.ts`),
   step 6 offers each change on its own. A fold goes *into* the block, so a no
   to the block cannot leave a fold standing. In step 3, when the upgrade is
   declined, nothing is folded into the old block or the old section either.
   The opening sentence, step 8 and step 9's report also leave out a confirmed
   edit to a Laika mention inside another section.
2. **The exit-code wording is too broad.** The comment in
   `cli/src/project-check.ts`, `cli/README.md` and the usage text must all say
   the same true thing:
   - block current, no credential, no `--harness`: prints, exit `0`;
   - block missing or old: exit `1` whatever else is true;
   - `--harness X` with no credential for X: exit `2`, unless `--offline` (`0`)
     or the block needs action (`1`).
3. **The order of checks decides the exit.** `--harness X` with no credential
   still exits `0` when no project is named, because the *no project named*
   check runs before the credential check. The *several tools* case has the
   same problem. An explicit `--harness` that cannot record exits `2` whatever
   the order. A missing or old block still exits `1`.
4. **The refused-tool message overstates.** *"so this check cannot record for
   it"* is not strictly true: `readCredential` also takes `LAIKA_AGENT_TOKEN`
   with `LAIKA_AGENT_URL` from the environment, and `laika agent login` saves
   a file for any harness. The message says what is true, and the README
   documents it.
5. **The web offers a command that cannot record.** V3 Project setup step 3
   builds `laika project check --harness antigravity`. Antigravity is a tool
   `laika tool add` refuses, as are Copilot CLI and Copilot cloud, which the
   board knows as `other`. Run as given, that command exits `2`, so step 3 can
   never be recorded this way. For those tools the page says Laika cannot
   check the tool's repository from the device yet, points to *I've added it*,
   and shows the tool's manual note. The command stays only for tools that can
   record. The list comes from the same source as the CLI's refusal list, with
   a test that fails if they drift.

## Acceptance criteria

- [x] Prompt: a fold goes into the block. If I say no to the block, nothing is
      folded into it. In step 3, if I decline the upgrade, nothing is folded
      into the old block or section.
- [x] Prompt: the opening sentence, step 8 and step 9's report cover a
      confirmed edit to a Laika mention inside another section.
- [x] Every earlier prompt guarantee still holds. Classic `projectPrompt` stays
      byte-identical and its CONTROL hash test passes.
- [x] CLI: an explicit `--harness` that cannot record exits `2` whatever the
      order of the checks: no credential for that tool, with or without a
      project named. *Several tools, no `--harness`* exits `2` with or without
      a project named. A missing or old block still exits `1`, and `--offline`
      still exits `0`.
- [x] CLI: the exit-code comment, the usage text and `cli/README.md` give the
      same, precise statement, and each part of it is true of the code.
- [x] CLI: the refused-tool message says only what is true, and the README
      quotes its wording.
- [x] Web: step 3 shows `laika project check` only for a tool the CLI can set
      up, and therefore record for. Antigravity, `other` and every tool
      `laika tool add` refuses get the honest path instead: Laika cannot check
      this tool's repository from the device yet, so record it yourself with
      *I've added it*, plus the tool's manual note.
- [x] Web: the set of CLI harnesses that get the command equals the set
      `planFor` does not refuse. A test reads `cli/src/tool-add.ts` and
      `cli/src/agent-adapters.ts` and fails if they drift.
- [x] Each change has a test that fails when the change is undone. The task
      notes say how this was checked.

## Notes

- SHELL: `server/web/` and `cli/`. Files:
  `server/web/src/routes/screens/connect/connect-copy.ts`,
  `server/web/test/routes/screens/connect/project-block-revision.test.ts`,
  `server/web/src/routes/screens/developer/v3/project-setup.ts`,
  `server/web/src/routes/screens/developer/v3/ProjectSetupTab.tsx`,
  `server/web/test/routes/screens/developer/v3/project-setup.test.ts`,
  `cli/src/project-check.ts`, `cli/test/project-check.test.ts`,
  `cli/README.md`.
- PR #242 (LAI-1086) is open and touches other `developer/v3/` files. Keep
  edits to shared files small, and merge `origin/master` if it lands.
- Belka load rule: run one test file at a time with a single worker, and
  wait while the 1-minute load average is above 15. Do not run the full suite
  locally; CI runs the gate.
- Board card: LAIKA-944 (`external_ref: LAI-1091`).

## How it was checked

- Each change has a test: the prompt's in
  `project-block-revision.test.ts`, the CLI's in
  `cli/test/project-check.test.ts`, and the web's in
  `developer/v3/project-setup.test.ts` plus one browser case in
  `test/browser/project-setup.test.ts`.
- Each file was run alone with `node --test --test-concurrency=1`, after
  waiting for the 1-minute load to fall below 15:
  `project-block-revision.test.ts` 33/33, `project-check.test.ts` 56/56,
  `project-setup.test.ts` 32/32, `tool-catalog.test.ts` 8/8, and the browser
  file filtered to the new case and *the whole flow* 2/2. These counts are
  the `# tests` that node reports, subtests included. `tsc --noEmit` exited
  0 for both `cli` and `server/web`. `eslint` and `prettier --check` on the
  changed files exited 0.
- A mutation script (scratchpad, not committed) undid each change in turn,
  anchor-checked. It ran only that change's test file and restored the file
  by checksum. `git status` was clean afterwards. All 17 went red on the
  test named for them:
  - P1/P2: step 6's fold rule removed, then step 3's declined-update rule:
    *a fold goes into the block*.
  - P3: the opening without the mention: *the opening names what besides
    the block*.
  - P4/P5: step 8 back to *"Change nothing else."*, then the report without
    mentions: *a confirmed edit to a mention*.
  - C1: the *no project named* check before the credential again:
    *--harness with no credential and no project named*.
  - C2: `--harness` with a credential and no project, made `skipped`:
    *--harness with its credential but no project named*.
  - C3/C4: the old refused message, or a README quote one comma off: *a
    refused tool is told what would record for it*.
  - C5/C6/C7: one case of exit 2 dropped from the usage, the comment or the
    README: *usage / comment / readme says each line of it*.
  - W1: the command ignoring `cliSetup`: *the harnesses that get a command
    are the ones laika tool add does not refuse*.
  - W2: no manual note: *instead of a command*.
  - B1/B2/B3: the command branch always taken, the *Not recorded* reason
    always naming the check, and the foot note always naming it: the
    browser case *a tool laika tool add refuses gets no command*.
- Classic `projectPrompt` is untouched. The CONTROL hash test passes in the
  same file.
- One reading beyond the brief: `--harness X` **with** a credential but no
  project to record against now also exits `2`. `--harness` is a request to
  record (LAI-1090), and the brief asked for exit 2 for an explicit
  `--harness` that cannot record, whatever the order. A bare run in the same
  state still only prints, and exits `0`. The test *no --harness and no
  project named* pins that.
- Two more places in step 3 told a refused tool to run the check: the
  *Not recorded* reason and the foot note. The browser case caught the first.
  Both now say to record it yourself.

## Review round 1 (PR #244, head `c8b9e667`): fixed in the same PR

The review failed one wording blocker. The code passed a 3360-run probe
with 0 mismatches.

- **B1:** the exit statement said a wrong task-key prefix exits `1`
  *"whatever else is true, --offline included"*. This CLI learns of a wrong
  prefix only from the board's reply to a recorded check. *Whatever else is
  true* now covers only a missing or old block and one naming a project
  other than `--project`. A wrong prefix, or a project the board says is
  wrong, gives `1` only once the board has recorded the check. The `2` and
  `0` lines now say *nothing this run can see needs action*. This is fixed
  in all three places and in the test's statement. A new test pins the
  measured behaviour: recorded `1`, `--offline` `0`, no credential `0`,
  board down `2`, several tools `2`, `--harness` with no credential `2`.
- **N1:** the `2` line now says *"--harness names a tool with no credential
  here, or names one but no project is named"*.
- **N2:** the statement now says `LAIKA_AGENT_TOKEN` with `LAIKA_AGENT_URL`
  wins over the several-tools rule. A test shows it records and exits `0`.
- **N3:** the README lists `LAIKA_AGENT_TOKEN` with its board from
  `LAIKA_AGENT_URL` or, failing that, the tool's own file. A test checks
  both the README and the behaviour.
- **N4:** prompt step 8 now lists a new file's opening lines (Cursor's front
  matter, named only where step 5 writes it) and the lines a fold keeps
  below the block.
- **N6:** the drift test now compares the whole normalised statement from
  *"first that applies:"* to the end in each place, so an added clause fails
  too. The README's lead-in was reworded so the anchor phrase reads the same
  in all three places.
- `origin/master` (`e45a46ee`, with #242) was merged first. Nothing
  overlapped.
- Checked each file alone, with one worker, once the load was below 15:
  `project-block-revision.test.ts` 33/33, `project-check.test.ts` 59/59,
  `project-setup.test.ts` 32/32, `tool-catalog.test.ts` 8/8. `tsc` exited 0
  for both packages; `eslint` and `prettier --check` exited 0 on the changed
  files.
- Mutations: 8 more, each run against only its test file and restored by
  checksum, with `git status` clean afterwards. All went red on the test
  named for them:
  - R1: the comment's old `1` line;
  - R2: the usage without *"names one but"*;
  - R3: the README without the environment sentence;
  - R4: saved tools counted before the environment;
  - R5: the README's old credential sentence;
  - R6: a contradicting clause added to the usage only, which the old
    clause-by-clause test let through;
  - R7: step 8 without the kept lines;
  - R8: step 8 without the front matter.
