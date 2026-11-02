---
id: LAI-1084
title: 'Project setup: replace a hand-written Laika section, and a hint for a CLI older than the board'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1082]
status: review
started: 2026-11-02T17:02:36+05:30
finished: 2026-11-02T17:19:41+05:30
---

## Why

Two gaps found while using V3 Project setup on the OnRoute project (owner,
2026-11-02):

1. **The prompt duplicates a hand-written Laika section.** OnRoute's
   `CLAUDE.md` already had a `## Laika board ritual` section. It had no
   `<!-- laika:begin … -->` / `<!-- laika:end -->` markers and no
   *"This project is tracked on a Laika board."* line. `projectSetupPrompt`
   looks only for those, so Claude Code appended a whole new 40-line block,
   and the file now has two overlapping Laika sections.
2. **"Check it from your device" assumes a new CLI.** A CLI older than the
   board fails with `laika: unknown command "project"`, and the page gives no
   way forward. Old CLIs have no `laika update` either.

## Acceptance criteria

- [x] V3's `projectSetupPrompt` tells the tool to look for any section clearly
      about the Laika board before it appends: a heading that mentions Laika,
      or text that mentions `laika_whoami`, `get_project_context`,
      `start_working`, `finish_task`, the board's address, or this project's
      task keys. If it finds one without markers, the tool shows it, offers to
      replace it with the single marked block (keeping any lines a person
      wants), shows the diff and waits for confirmation. It never appends a
      second Laika section.
- [x] Every earlier guarantee is kept: no token, no commit, no MCP config
      change, only the Laika block changes, and the revision/project/prefix
      up-to-date rule is unchanged.
- [x] Classic `projectPrompt` stays byte-identical, and its existing CONTROL
      hash test still passes.
- [x] Under the *Check it from your device* command there is one short hint:
      the check needs a Laika CLI that matches this board (it names the
      board's helper commit from `GET /developer/compatibility` when the
      answer has one, with no build strings written into the code). It says
      to check with `laika version`. If that says unknown command, the CLI is
      older than the board: run `git -C <your Laika checkout> pull --ff-only`,
      then `laika version`. Newer CLIs use `laika update`. No new colours,
      existing tokens only, both themes.
- [x] Tests: the prompt has the detection instruction and still has every
      earlier guarantee; the hint's words (unit) and its rendering (browser).

### Added by the owner mid-task (2026-11-02, a live run on Belka)

- [x] The page's check command carries `--harness <the tool picked in step 1>`,
      using the harness ids the CLI accepts, secret-free and shell-safe.
      Without it, a device with two tools set up records nothing and step 3
      stays *Not recorded*. A tool the CLI cannot name for certain (`other`,
      or one with no adapter) gets no `--harness` rather than a wrong one.
- [x] The CLI's ambiguous `--harness` case: exit non-zero **unless an
      existing test or contract pins exit 0**. One does:
      `cli/test/project-check.test.ts` ("several tools here and no
      --harness: records nothing and says why") asserts `r.code === 0`. Per
      the owner's rule, the CLI keeps 0 and is unchanged. See Notes.
      *Superseded by review round 1 below: CHIEF chose exit `2`.*

## Notes

- SHELL, `server/web/` only. The owner gave this instruction directly, and it
  goes to `master` as a PR.
- Keep it small: the prompt text, the one hint, and tests. A design-match
  redesign of the V3 Developer access screens starts in parallel, so restyle
  nothing.
- Board card: LAIKA-937.
- **Classic mode is unchanged.** `projectPrompt` and `projectBlock` are not
  touched, and `project-block-revision.test.ts`'s CONTROL hashes still pass.
- **The exit-code pin is worth a decision.** `project-check.ts`'s own exit
  doc says `0` means current *"and recorded, when a credential was there to
  record it"*, so the ambiguous case contradicts that doc, and `2` (*could
  not record*) fits it. Switching costs one line in `project-check.ts` and one
  assertion in that test. It is the owner's call, so it was not made here.

## Review round 1 — CHIEF's decision (2026-11-02, on Pawan's delegation)

Switch the ambiguous-harness case to exit `2`, as recommended. Done:

- [x] `cli/src/project-check.ts`: the case is now a `failed` record, so it
      exits `2` through the existing mapping. *Needs action* (`1`) still
      wins, and the message is unchanged word for word. The exit-code comment
      names the case.
- [x] `cli/test/project-check.test.ts`: the pinned test asserts `2`. Two
      more tests: with no block, *needs action* still wins (`1`); and with
      `--harness codex` on a two-tool device, the check records (`0`).
- [x] `cli/README.md`'s exit-code line names the case.
- [x] No caller relies on exit `0` for it. `cli/src/index.ts` is the only
      dispatcher of `projectCheck`, and it returns the code as is. No hook,
      `laika doctor` path, plugin script or web page runs the command or reads
      its exit, and nothing reads the JSON's `record.kind`.
- [x] The PR notes that `307f0315`'s type `style(web)` should have been
      `chore(web)`. It stands, because pushed commits are not rewritten.

## Review round 2 — review of PR #237 at 38077c37: PASS, with fixes in this PR

- [x] N1: `project-setup.ts`'s comment on `projectCheckCommand` says the
      no-`--harness` case exits 2, not 0.
- [x] N2: a hand-written Laika section must be *clearly about the Laika
      board*. Mentions under a heading about something else are shown and
      asked about, and such a section is never replaced.
- [x] N3: the opening reads "Only the Laika block in that file, or, with my
      confirmation, a hand-written Laika section, is yours to change".
- [x] N4: a current block beside hand-written Laika sections offers to fold
      each one in (diff and confirm) before it reports up to date. Step 3
      offers the same in its diff, and step 4 handles one or more. Kept lines
      carry no second Laika heading. There are explicit outcomes for *folded
      N sections* and *you said no and I changed nothing*.
- [x] N5: `--harness X` with no credential for X, while other tools have one,
      names X and those tools (names only) and exits 2. With no credential at
      all it still exits 0, as the README documents.
- [x] N6: the "guarantees it had before" test matches each phrase across line
      wraps. All nine phrases were checked against the prompt at `ec91f053`
      as well as the current one.
- [x] Nit: the hint shows `git -C ~/laika pull --ff-only` (`PLUGIN_HOME`),
      says "if you cloned Laika somewhere other than ~/laika, use that
      folder", and covers a `laika update` that is unknown. A test checks
      that no command carries `<`, `>` or other shell metacharacters.
