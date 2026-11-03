---
id: LAI-1111
title: 'Launcher enable works on a real laptop: one readline, every check up front, path and remote reasons'
area: cli
assignee: shell/belka
priority: p1
depends-on: [LAI-1109]
discovered-from: LAI-1109
status: review
started: 2026-11-03T18:50:00+05:30
finished: 2026-11-03T19:12:00+05:30
---

## Why

A live `laika agent launcher enable --dry-run` on Belka, driven with `expect`
at `23f0267f`, could not be finished in one sitting. Typed-ahead answers were
swallowed and later prompts hung, failing Claude checks came out one at a time
after the project questions, the checkout path refused `~` and relative paths
with no reason given for each remote, and the hints did not name the fix that
actually works. `--dry-run` also skipped the config and git checks that `run`
does, so a service could exit silently on the first start.

## Acceptance criteria

- [x] **One readline for the whole enable flow.** Answers typed or pasted ahead
      are read by the next prompt instead of being swallowed. End of input says
      `input ended`, not `enable needs a terminal to answer in`. A typed answer
      still wins over a close that arrives with it (LAI-1109).
- [x] **Harness checks come before the project questions**, and every failing
      Claude Code check is reported at once (version, program location and
      permissions, launcher-safe MCP entry, hooks), each with its exact fix.
- [x] **Checkout path**: a leading `~` is expanded, a relative path is resolved
      against the current directory and the resolved path is printed, a bad
      answer is asked again (at most 3 times), and each rejected remote says why
      (for example an SSH host alias such as `git@github-personal:…` is not
      `github.com`).
- [x] **The launcher-safe MCP hint names the real fix** when the user-level
      `laika` entry is not tool-add's: quit Claude Code, `claude mcp remove
      laika --scope user`, then in the browser Tools → the tool → ⋯ → Reconnect
      and run the `laika tool add claude-code --exchange <id>` it shows.
      `claude-mcp.ts` follows `CLAUDE_CONFIG_DIR` as `mcp-headers.ts` does.
- [x] **The hooks check reads the hook commands** in `settings.json`: a
      `laika-agent-hook` command for each needed event, and its script exists.
      The hint is `laika agent hooks on --harness claude-code` from the updated
      checkout.
- [x] **A refused program location says why** (a group- or other-writable
      folder such as Homebrew's `/opt/homebrew/bin`) and gives the fix options.
- [x] **`--dry-run` loads and validates the generated config and checks git >=
      2.41**, as `run` does.
- [x] **Enable prints which checkout the service runs from** and warns that
      switching branches there changes the launcher's code.
- [x] An end-to-end `enable --dry-run` through a real pty with `expect`,
      answering one prompt at a time and with every answer pasted at once (red
      before the first criterion), and unit tests for the rest.

## Notes / context

cli/ only: `cli/src/agent-launcher-service.ts`, `cli/src/claude-mcp.ts`, the
check helper in `cli/src/agent-hooks.ts`, their tests, and `cli/README.md`. A
parallel builder is in `agent-launcher.ts`, `agent-workspace.ts`,
`agent-omnigent*`, `mcp-headers.ts` and `tool-add.ts`; this task does not edit
those. Linux CI skips the pty test with a clear reason when `expect` is absent.

**As built.** CI's Ubuntu image has no `expect`, so on Linux the pty test
drives util-linux `script -qec` from node instead of skipping; it skips only
where neither driver exists. Verified in a Debian trixie container (git 2.47, no
`expect`): 4/4. The browser path the MCP hint names is the one the V3 screen
has: Developer access → Tools → the tool → *Reconnect (new credential)…* (there
is no ⋯ menu on that panel). The `CLAUDE_CONFIG_DIR` part of LAI-1110 that this
covers is enable's MCP check only (`claude-mcp.ts`); `doctor`, the hook install
and `connect` still read the default paths, as LAI-1110 says.

## Review fixes (PR #259, independent review of `7039ba68`: FAIL)

- **B1, a token in a remote URL was printed.** `checkRepo` echoed
  `git remote get-url` as written. Every remote URL printed now goes through
  `redactedUrl`, so whatever stands before the host is `***`; only scp-style
  `git@` is kept. A URL with `user:secret@` gets its own reason. A census of
  every interpolated value in the diff's output strings found no other print
  of a remote URL. A sentinel test covers `user:token@`, `token@` and
  scp-style URLs, and goes red with the redaction removed.
- **B2, the MCP check followed this shell's `CLAUDE_CONFIG_DIR`.** A launched
  run never gets it: the service passes only HOME and PATH, and `LAUNCH_ENV`
  has no `CLAUDE_CONFIG_DIR`. The check now reads `~/.claude.json`, as it
  already read `~/.claude/settings.json`. A `CLAUDE_CONFIG_DIR` in the shell
  is printed as a note. `claude-mcp.ts` still follows `env` for the callers
  that pass it. Passing `CLAUDE_CONFIG_DIR` through to runs is not done here:
  it is LAI-1110's.
- **N1:** `close()` ends the asker, so it never opens a reader again.
- **N2:** the pty test links a git of 2.41 or later into its PATH, or skips
  saying which gits it found.
- **N3:** too old a git asks nothing before refusing.
- **Optional, both done:** Ctrl+C at a question says `interrupted`, and the
  suggested `remote add` name is one the checkout does not have yet.
