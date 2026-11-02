---
id: LAI-1086
title: 'Update your Laika CLI: one guidance in the UI where a developer needs it, and a once-a-day CLI notice'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-11-02T17:20:28+05:30
---

## Why

Owner request (Pawan, 2026-11-02): *"if we don't add this in the UI, how will
a developer know how this works and how to update to the new Laika version?"*

The incident behind it: following V3 Project setup, `laika project check`
answered `laika: unknown command "project"`. The CLI checkout it ran from
(`~/laika`, reached through `~/.local/bin/laika`) was 389 commits behind the
board, and nothing in the UI said the CLI was too old or how to update it.
A CLI that old has neither `laika version` nor `laika update` (#200, #207), so
the only way forward for it is to update the git checkout.

## Acceptance criteria

- [ ] One shared component, *Update your Laika CLI* (V3 wizard/help style,
      existing tokens, both themes, 390 px), saying in this order: how to
      check (`laika version` shows commit and protocol; *unknown command*
      means the CLI predates this board); how to update a CLI that has
      `laika update` (`laika update --check`, then `laika update`, with
      `--allow-http` only on a plain-http board, as #218 does); how to update
      an older CLI (`git -C ~/laika pull --ff-only`, with a note to replace
      `~/laika` with where Laika was cloned; a path-discovery line only if
      tested on macOS and Linux; never reset, force or stash); what to do
      after (`laika doctor`, restart Claude Code, Codex may ask to re-trust
      hooks in `/hooks`). The board's build commit, protocol and minimum
      helper protocol come from `GET /developer/compatibility`, never
      hard-coded. No secret anywhere.
- [ ] Tool update states (*Update available*, *Update required for …*,
      *Version unknown*) link to it; *Version unknown* says how to make the
      version appear (`laika update`, worded to be true once LAI-1085 makes
      it report when already current). The device's helper summary links to
      it when one of its tools needs it.
- [ ] Overview: a quiet notice, linking to it, when any of the reader's own
      tools is *Update required* or has never reported; none when all are up
      to date.
- [ ] Add device and Add tool: before the `laika device pair` /
      `laika tool add` command, *Already have Laika installed? Make sure it's
      current* opens it.
- [ ] Project setup's check-step hint is **not** edited (LAI-1084 owns it);
      the component is exported so LAI-1084 or a follow-up can use it.
- [ ] CLI: a protocol-2 CLI talking to a board whose build is newer, or
      whose protocol it does not meet, prints one stderr line naming both
      commits and `laika update` — at most once per 24 h per board (cache
      under `~/.laika`, no secrets), never with `--json`, never failing the
      command or changing its exit code, never on hook or MCP paths.
      `cli/src/update.ts` is not edited (LAI-1085 is on it).
- [ ] Tests: component content (every path, `--allow-http` only for http,
      no secrets); each placement in the right states and not otherwise;
      Overview notice hidden when up to date; CLI notice once per 24 h,
      never on `--json`, never on hook paths, exit code unchanged.
      Screenshots of each placement, light and dark, 1440 and 390 px, in
      `.polly/evidence/LAI-1086/`.

## Notes

- SHELL: `server/web/` and `cli/`. No server change: the compatibility
  answer already carries what the guide needs.
- Belka load rule: one test file at a time, single worker; CI runs the gate.
- A design-match redesign of the V3 screens follows; placements stay small
  and componentised so it can move them.
