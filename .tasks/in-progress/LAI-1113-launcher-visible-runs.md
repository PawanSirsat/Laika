---
id: LAI-1113
title: 'Launcher runs are visible on the laptop: notifications, watch, a Terminal viewer per run, and an opt-in skip-permissions mode'
area: cli
assignee: shell/belka
priority: p1
depends-on: []
status: in-progress
started: 2026-11-03T22:55:00+05:30
---

## Why

The owner, 2026-11-03, in chat (approved): unattended launcher runs happen
out of sight. A run starts, works for minutes and exits, and the laptop shows
nothing. The owner wants all three ways to see one, and an option to run
Claude Code without its permission allowlist on a device where they choose
that.

## Acceptance criteria

- [ ] **Notifications.** When the launcher starts a run and when it exits,
      macOS shows a notification through `/usr/bin/osascript` with `display
      notification`, called with an argv array (`execFile`), never a shell.
      Title and body are built **only** from validated internal values: a
      task key matching `^[A-Z][A-Z0-9]*-[0-9]+$`, a harness from the known
      list, numbers. No card text, device name or note can reach them; a
      hostile key is refused rather than escaped. Linux uses `notify-send`
      when present and skips silently otherwise. Config `"notify": true |
      false`.
- [ ] **`laika agent launcher watch [--run <offer-or-run-id>] [--once]`**, a
      read-only live view. It tails `~/.laika/launcher/audit.jsonl` for
      start, exit and refused events, and for a running or chosen run prints
      the harness transcript live: for Claude Code,
      `~/.claude/projects/<mangled worktree dir>/<uuid>.jsonl` (mangling
      checked against a real file on Belka), shown as 💬 assistant text and
      🔧 tool names with a short, single-line, length-capped input summary,
      control and bidi characters stripped. Closing it never affects a run.
      `start` audit events record the worktree and transcript folder so
      watch does not guess. Omnigent runs show audit events only and say the
      transcript lives in Omnigent.
- [ ] **A Terminal window per run** (opt-in, macOS): config `"open_terminal":
      true | false`. A start opens Terminal running `laika agent launcher
      watch --run <id>` through `tell application "Terminal" to do script`,
      where the only interpolated values are a validated run id and the
      absolute laika path from the launcher's own config, quoted safely, with
      a test that hostile values cannot inject. It is a viewer only: the run
      stays the daemon's child, so closing the window does not stop it. If
      Terminal cannot be opened, one line is logged and the run continues.
- [ ] **Permission mode for Claude Code runs**: `"permissions": "allowlist"`
      (the default, today's argv) or `"skip"`. `skip` builds the argv with
      `--dangerously-skip-permissions` in place of `--permission-mode
      dontAsk --permission-prompts none --allowedTools …`, and keeps the full
      `--disallowedTools` deny list, `--max-turns` and `--max-budget-usd`.
      Whether deny rules still hold in that mode, and whether `-p` takes it
      unattended, is checked against the current official Claude Code docs
      (raw `.md`, grepped) and written with the URL into `cli/README.md` and
      `enable`'s output.
- [ ] **`enable` asks** for notifications (default yes), a Terminal per run
      (default yes) and permissions; `skip` only after the owner types the
      exact word `skip-permissions`, after a warning that an unattended run
      can then run any command with the owner's local credentials and that
      GitHub branch protection on master is the real guard. `launcher check`
      and `status` show the three settings.
- [ ] Tests: notification argv (hostile key and device text refused), watch
      transcript discovery and rendering from a fixture and a real-format
      sample, Terminal command quoting and injection, permissions argv in
      both modes (deny list present in both), enable prompts with typed
      answers, status output. `cli/README.md`'s launcher section documents
      all of it.

## Notes / context

cli/ only: `cli/src/agent-launcher.ts`, `cli/src/agent-launcher-service.ts`,
new `cli/src/agent-launcher-watch.ts` and `cli/src/agent-launcher-visible.ts`,
their tests under `cli/test/`, and `cli/README.md`. No new dependency.

The decision entry is CHIEF's to write (D-128, owner, 2026-11-03); its draft
is in the PR description.
