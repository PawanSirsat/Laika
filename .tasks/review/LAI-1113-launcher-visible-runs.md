---
id: LAI-1113
title: 'Launcher runs are visible on the laptop: notifications, watch, a Terminal viewer per run, and an opt-in skip-permissions mode'
area: cli
assignee: shell/belka
priority: p1
depends-on: []
status: review
started: 2026-11-03T22:55:00+05:30
finished: 2026-11-03T23:40:00+05:30
---

## Why

The owner, 2026-11-03, in chat (approved): unattended launcher runs happen
out of sight. A run starts, works for minutes and exits, and the laptop shows
nothing. The owner wants all three ways to see one, and an option to run
Claude Code without its permission allowlist on a device where they choose
that.

## Acceptance criteria

- [x] **Notifications.** When the launcher starts a run and when it exits,
      macOS shows a notification through `/usr/bin/osascript` with `display
      notification`, called with an argv array (`execFile`), never a shell.
      Title and body are built **only** from validated internal values: a
      task key matching `^[A-Z][A-Z0-9]*-[0-9]+$`, a harness from the known
      list, numbers. No card text, device name or note can reach them; a
      hostile key is refused rather than escaped. Linux uses `notify-send`
      when present and skips silently otherwise. Config `"notify": true |
      false`.
- [x] **`laika agent launcher watch [--run <offer-or-run-id>] [--once]`**, a
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
- [x] **A Terminal window per run** (opt-in, macOS): config `"open_terminal":
      true | false`. A start opens Terminal running `laika agent launcher
      watch --run <id>` through `tell application "Terminal" to do script`,
      where the only interpolated values are a validated run id and the
      absolute laika path from the launcher's own config, quoted safely, with
      a test that hostile values cannot inject. It is a viewer only: the run
      stays the daemon's child, so closing the window does not stop it. If
      Terminal cannot be opened, one line is logged and the run continues.
- [x] **Permission mode for Claude Code runs**: `"permissions": "allowlist"`
      (the default, today's argv) or `"skip"`. `skip` builds the argv with
      `--dangerously-skip-permissions` in place of `--permission-mode
      dontAsk --permission-prompts none --allowedTools …`, and keeps the full
      `--disallowedTools` deny list, `--max-turns` and `--max-budget-usd`.
      Whether deny rules still hold in that mode, and whether `-p` takes it
      unattended, is checked against the current official Claude Code docs
      (raw `.md`, grepped) and written with the URL into `cli/README.md` and
      `enable`'s output.
- [x] **`enable` asks** for notifications (default yes), a Terminal per run
      (default yes) and permissions; `skip` only after the owner types the
      exact word `skip-permissions`, after a warning that an unattended run
      can then run any command with the owner's local credentials and that
      GitHub branch protection on master is the real guard. `launcher check`
      and `status` show the three settings.
- [x] Tests: notification argv (hostile key and device text refused), watch
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

**As built.**

- **Docs finding** (raw `.md`, grepped, 2026-11-03): `--dangerously-skip-permissions`
  is "Equivalent to `--permission-mode bypassPermissions`" (`cli-reference.md`);
  "Deny rules block in every mode, including `bypassPermissions`" and
  `--disallowedTools` is deny rules; `-p` takes it with no dialog and denies
  the few calls that would still prompt (`permission-modes.md`). But a Bash
  deny rule matches the command as written, not the program
  (`permissions.md`, "What a Bash rule doesn't match"). So the deny list is
  kept and enforced, and is still not a boundary; `enable` and the README say
  so with the URL.
- **The `permissions` key is checked against the argv**: an argv that skips
  permission checks without `"permissions": "skip"` is refused at load, and a
  `skip` argv must carry `--disallowedTools`. A file without the new keys
  loads as before: no notification, no window, the allowlist.
- **The Terminal command's `laika` path is a config key** (`"laika"`, required
  by `open_terminal`), written by `enable` from the `laika` on `PATH` and held
  to the same program rules as a harness's `argv[0]`.
- Both osascript scripts are fixed `on run argv` lines with the values as
  arguments after `--`, so no value is ever AppleScript source; the viewer
  line single-quotes the path and takes only a ULID.
- The transcript folder rule (every character not a letter or digit as `-`)
  was measured on every folder in Belka's `~/.claude/projects`, and `watch
  --once --run 01M6H3V14WKG0HKSF5Y8SY6CSR` rendered LAIKA-968's real
  transcript (found through its `workspace.json`, since that start predates
  the new audit fields).
- Not done here: no notification is shown and no Terminal window is opened by
  the tests; the first real window may need macOS Automation allowed. The
  `laika` a viewer runs must be from a checkout that has this change.

## Review fixes (PR #260, review of `3d8662ab`: FAIL)

- **B1, skip-mode validation too weak; check/status overclaimed.**
  `CLAUDE_ALLOWED` and `CLAUDE_DENIED` moved from `agent-launcher-service.ts`
  to `agent-launcher.ts` (re-exported from the service; no cycle).
  `permissionsProblem(argv, 'skip')` now needs the shape `claudeArgv(…, 'skip')`
  writes: `--dangerously-skip-permissions`; one `--disallowedTools` followed
  by every `CLAUDE_DENIED` rule (extra rules allowed); one `--max-turns` and
  one `--max-budget-usd`, each a number above 0; none of `--permission-mode`,
  `--permission-prompts`, `--allowedTools` (also `--flag=value`). Both review
  argvs are refused, with tests at `permissionsProblem` and at `loadConfig`;
  the enable-written argv is accepted. The `check` / `status` line is
  `permissionsLine(argv)`, read from the argv: rule count, whether every
  launcher rule is there, and the two caps as written.
- **B2, the closing-watch test could not fail.** It now runs the real
  `startLauncher` (shared rig, `test/support/launch-rig.ts`), so the start
  line carries the run's `pid` and `status.json` lists the running run, both
  asserted. Proven: a temporary mutant in `watchCommand` that, on SIGHUP, kills
  every audited start `pid` and then dies by SIGHUP made the test fail on
  "the launcher still has the run"; reverted (checksum matched) and the test
  passes. A first mutant using `require` failed for the wrong reason
  (`ReferenceError`) and was not counted.
- **Also:** README says plainly that a pre-LAI-1113 skip argv is refused until
  `"permissions": "skip"` and the shape (and that `run --service` then writes
  one `refused` `config_invalid` line, exits 0 and starts nothing — tested).
  `skipsChecks` matches only the exact flags and `--permission-mode
  bypassPermissions` / `=bypassPermissions`. osascript and notify-send run
  with `PATH`, `HOME`, `LANG`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`
  only (`commandEnv`, tested through the real runner). `watch` prints the
  transcript path through `oneLine`. `laikaPathProblem` refuses a backslash.
  `oneLine` redacts `lai_…` tokens and `Bearer …` values after stripping. The
  exit notification takes its words from `exitReason(run)`, the audit's own
  reason, so a stop outranks an earlier timeout in both.

## Review fixes, round 2 (PR #260, review of `ab838675`: FAIL)

- **The caps could be raised in the `=` spelling.** `claudeShape` counts every
  spelling of `--disallowedTools` (`--disallowed-tools`, and either as
  `--name=value`), `--max-turns` and `--max-budget-usd` as an occurrence, so
  the "exactly one" rule refuses enable's argv with `--max-budget-usd=99999`,
  `--max-turns=999999`, `--disallowedTools=…` or `--disallowed-tools …`
  appended; a lone `--flag=value` is refused too, since a value is read as the
  word after the bare flag. `check` / `status` show such a cap as "not
  readable", never as the first value. All of them are in the test table next
  to `[...ok, '--max-turns', '9999']`, plus the repro at `loadConfig`.
  Mutation: back to round 1's bare-only count, the three tests that hold
  these went red (`exit 1`, 3 of 3), the line showing `--max-turns 200` after
  a raised cap; restored, checksum matched.
- **Inline `--settings`.** In allowlist mode an argv whose `--settings` (or
  `--settings=`) inline JSON names `bypassPermissions` counts as skipping and
  is refused; a settings file path cannot be inspected, which the README says,
  with the docs' order: `--permission-mode` above any settings
  `defaultMode`.
- **D-128 (`docs/DECISIONS.md`), the one Consequences sentence CHIEF
  authorised** in the round-2 review: replaced with CHIEF's wording on the
  refused hand-written skip argv.

