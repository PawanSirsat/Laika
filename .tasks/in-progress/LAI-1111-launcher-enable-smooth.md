---
id: LAI-1111
title: 'Launcher enable works on a real laptop: one readline, every check up front, path and remote reasons'
area: cli
assignee: shell/belka
priority: p1
depends-on: [LAI-1109]
discovered-from: LAI-1109
status: in-progress
started: 2026-11-03T18:50:00+05:30
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

- [ ] **One readline for the whole enable flow.** Answers typed or pasted ahead
      are read by the next prompt instead of being swallowed. End of input says
      `input ended`, not `enable needs a terminal to answer in`. A typed answer
      still wins over a close that arrives with it (LAI-1109).
- [ ] **Harness checks come before the project questions**, and every failing
      Claude Code check is reported at once (version, program location and
      permissions, launcher-safe MCP entry, hooks), each with its exact fix.
- [ ] **Checkout path**: a leading `~` is expanded, a relative path is resolved
      against the current directory and the resolved path is printed, a bad
      answer is asked again (at most 3 times), and each rejected remote says why
      (for example an SSH host alias such as `git@github-personal:…` is not
      `github.com`).
- [ ] **The launcher-safe MCP hint names the real fix** when the user-level
      `laika` entry is not tool-add's: quit Claude Code, `claude mcp remove
      laika --scope user`, then in the browser Tools → the tool → ⋯ → Reconnect
      and run the `laika tool add claude-code --exchange <id>` it shows.
      `claude-mcp.ts` follows `CLAUDE_CONFIG_DIR` as `mcp-headers.ts` does.
- [ ] **The hooks check reads the hook commands** in `settings.json`: a
      `laika-agent-hook` command for each needed event, and its script exists.
      The hint is `laika agent hooks on --harness claude-code` from the updated
      checkout.
- [ ] **A refused program location says why** (a group- or other-writable
      folder such as Homebrew's `/opt/homebrew/bin`) and gives the fix options.
- [ ] **`--dry-run` loads and validates the generated config and checks git >=
      2.41**, as `run` does.
- [ ] **Enable prints which checkout the service runs from** and warns that
      switching branches there changes the launcher's code.
- [ ] An end-to-end `enable --dry-run` through a real pty with `expect`,
      answering one prompt at a time and with every answer pasted at once (red
      before the first criterion), and unit tests for the rest.

## Notes / context

cli/ only: `cli/src/agent-launcher-service.ts`, `cli/src/claude-mcp.ts`, the
check helper in `cli/src/agent-hooks.ts`, their tests, and `cli/README.md`. A
parallel builder is in `agent-launcher.ts`, `agent-workspace.ts`,
`agent-omnigent*`, `mcp-headers.ts` and `tool-add.ts`; this task does not edit
those. Linux CI skips the pty test with a clear reason when `expect` is absent.
