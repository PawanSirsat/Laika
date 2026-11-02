---
id: LAI-1084
title: 'Project setup: replace a hand-written Laika section, and a hint for a CLI older than the board'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1082]
status: in-progress
started: 2026-11-02T17:02:36+05:30
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

- [ ] V3's `projectSetupPrompt` tells the tool to look for any section clearly
      about the Laika board before it appends: a heading that mentions Laika,
      or text that mentions `laika_whoami`, `get_project_context`,
      `start_working`, `finish_task`, the board's address, or this project's
      task keys. If it finds one without markers, the tool shows it, offers to
      replace it with the single marked block (keeping any lines a person
      wants), shows the diff and waits for confirmation. It never appends a
      second Laika section.
- [ ] Every earlier guarantee is kept: no token, no commit, no MCP config
      change, only the Laika block changes, and the revision/project/prefix
      up-to-date rule is unchanged.
- [ ] Classic `projectPrompt` stays byte-identical, and its existing CONTROL
      hash test still passes.
- [ ] Under the *Check it from your device* command there is one short hint:
      the check needs a Laika CLI that matches this board (it names the
      board's helper commit from `GET /developer/compatibility` when the
      answer has one, with no build strings written into the code). It says
      to check with `laika version`. If that says unknown command, the CLI is
      older than the board: run `git -C <your Laika checkout> pull --ff-only`,
      then `laika version`. Newer CLIs use `laika update`. No new colours,
      existing tokens only, both themes.
- [ ] Tests: the prompt has the detection instruction and still has every
      earlier guarantee; the hint's words (unit) and its rendering (browser).

## Notes

- SHELL, `server/web/` only. The owner gave this instruction directly, and it
  goes to `master` as a PR.
- Keep it small: the prompt text, the one hint, and tests. A design-match
  redesign of the V3 Developer access screens starts in parallel, so restyle
  nothing.
- Board card: LAIKA-937.
