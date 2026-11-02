---
id: LAI-1090
title: 'Project setup follow-ups from PR #237: a no leaves only that change alone, kept lines stay, mentions get a diff, and --harness X with no credential exits 2'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
discovered-from: LAI-1084
status: review
started: 2026-11-02T18:17:12+05:30
finished: 2026-11-02T18:31:12+05:30
---

## Why

Small follow-ups from the review of PR #237 (LAI-1084, merged as `7423ecec`).
Four are in V3's `projectSetupPrompt`
(`server/web/src/routes/screens/connect/connect-copy.ts`) and two are in the
CLI's `laika project check` (`cli/src/project-check.ts`). They ship in one PR.

1. **Step 6 fails closed.** Step 3 offers to upgrade the block *and* fold a
   hand-written section in, in one diff. Step 6 says *"If I say no to a change
   you offered, change nothing at all"*, so a no to the fold also throws away
   the upgrade.
2. **Kept lines can be offered again.** Lines a person keeps go directly below
   the end marker. On a later run they look like a hand-written Laika section,
   and the tool offers to fold them in again.
3. **A mention has no diff step.** For Laika mentions inside another section,
   the prompt asks *"what I want done with them"* but does not say to show the
   diff and wait before changing anything. Every other path does.
4. **The N5 message steers to the wrong tool.** `--harness X` with no
   credential for X, while other tools have one, says *"pass --harness with
   one of those"*. That records under a tool the person did not pick.
5. **CHIEF's decision.** An explicit `--harness X` is a request to record. So
   no credential for X exits `2` (*could not record*) even when no other tool
   has one either. A bare run (no `--harness`) with no credential keeps today's
   behaviour: it only prints, and exits `0`.

## Acceptance criteria

- [x] Prompt: a no to one offered change leaves only that change undone. Other
      changes the person confirmed still apply. Step 3 offers the block upgrade
      and each fold as separate changes, each one confirmed on its own.
- [x] Prompt: lines directly below the end marker were kept on purpose. The
      tool leaves them and never offers them as a hand-written Laika section.
- [x] Prompt: for Laika mentions inside another section, the tool shows the
      diff and waits for confirmation before changing anything.
- [x] Every existing prompt guarantee still holds: no token, no commit, no MCP
      config change, and only the Laika block or a confirmed hand-written Laika
      section changes. Classic `projectPrompt` stays byte-identical and its
      CONTROL hash test passes.
- [x] CLI: `--harness X` with no credential for X first suggests adding X
      (`laika tool add X`, from the board's Developer access → Tools → Add
      tool). Only after that does it mention other tools set up on this
      machine, by name. It never suggests recording under another tool.
- [x] CLI: an explicit `--harness X` with no credential for X exits `2`,
      whether or not other tools have one. A bare run with no credential still
      exits `0` and only prints. The exit-code comment in `project-check.ts`,
      the usage text if it names the case, and `cli/README.md` say so.
- [x] Each change has a test that fails when the change is undone. The task
      notes say how this was checked.

## Notes

- SHELL: `server/web/` and `cli/`. Files: `connect-copy.ts`,
  `test/routes/screens/connect/project-block-revision.test.ts`,
  `cli/src/project-check.ts`, `cli/test/project-check.test.ts`,
  `cli/README.md`.
- Belka load rule: run one test file at a time with a single worker, and
  wait while the 1-minute load average is above 15. Do not run the full suite
  locally; CI runs the gate.
- Board card: LAIKA-943 (`external_ref: LAI-1090`).

## How it was checked

- Each prompt change has a test in `project-block-revision.test.ts`; each CLI
  change has one in `cli/test/project-check.test.ts`.
- A mutation script undid each change in turn, ran only that test file with a
  single worker, and restored the file (checksum compared). All nine went red
  on exactly the test named for them:
  - W1, step 6 back to *"change nothing at all"*: *a no leaves only that
    change undone*.
  - W2, step 3's fold back *"in the same diff"*: *a current block beside a
    hand-written section*.
  - W3, the kept-lines sentence removed: *lines kept below the end marker*.
  - W4, the mention's diff step removed: *a hand-written Laika section is
    clearly about the board*.
  - C1, `--harness` with no credential anywhere back to exit 0: *no tool has
    a credential here: exit 2*, plus the `--json` and refused-tool cases.
  - C2, *"pass --harness with one of those"* restored: *while others have
    one: exit 2, add it first*.
  - C3, the other tools named before *add codex first*: the same test.
  - C4, a refused tool told to run `laika tool add`: *laika tool add
    refuses*.
  - C5, a bare run with no credential made `failed`: the existing *no
    credential: prints and records nothing* (exit 0).
- Classic `projectPrompt` is untouched. The CONTROL hash test passes in the
  same file.
- One addition beyond the brief: `planFor` (from `tool-add.ts`) keeps the
  message from suggesting `laika tool add antigravity`, a command `tool add`
  refuses. The board's check command does emit `--harness antigravity`.
