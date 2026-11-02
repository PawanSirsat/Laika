---
id: LAI-1091
title: 'Project check follow-ups from PR #241: a fold never outlives a declined block, exit codes stated precisely, --harness that cannot record exits 2 whatever the order, and no check command for a tool the CLI refuses'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
discovered-from: LAI-1090
status: in-progress
started: 2026-11-02T19:05:00+05:30
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

- [ ] Prompt: a fold goes into the block. If I say no to the block, nothing is
      folded into it. In step 3, if I decline the upgrade, nothing is folded
      into the old block or section.
- [ ] Prompt: the opening sentence, step 8 and step 9's report cover a
      confirmed edit to a Laika mention inside another section.
- [ ] Every earlier prompt guarantee still holds. Classic `projectPrompt` stays
      byte-identical and its CONTROL hash test passes.
- [ ] CLI: an explicit `--harness` that cannot record exits `2` whatever the
      order of the checks: no credential for that tool, with or without a
      project named. *Several tools, no `--harness`* exits `2` with or without
      a project named. A missing or old block still exits `1`, and `--offline`
      still exits `0`.
- [ ] CLI: the exit-code comment, the usage text and `cli/README.md` give the
      same, precise statement, and each part of it is true of the code.
- [ ] CLI: the refused-tool message says only what is true, and the README
      quotes its wording.
- [ ] Web: step 3 shows `laika project check` only for a tool the CLI can set
      up, and therefore record for. Antigravity, `other` and every tool
      `laika tool add` refuses get the honest path instead: Laika cannot check
      this tool's repository from the device yet, so record it yourself with
      *I've added it*, plus the tool's manual note.
- [ ] Web: the set of CLI harnesses that get the command equals the set
      `planFor` does not refuse. A test reads `cli/src/tool-add.ts` and
      `cli/src/agent-adapters.ts` and fails if they drift.
- [ ] Each change has a test that fails when the change is undone. The task
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
