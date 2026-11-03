---
id: LAI-1110
title: 'CLAUDE_CONFIG_DIR and CODEX_HOME honoured by doctor, the launcher service and hook install too'
area: shell
assignee: unclaimed
priority: p3
depends-on: [LAI-1108]
discovered-from: LAI-1108
status: backlog
---

## Why

LAI-1108 (h) made `laika tool add claude-code` and `tool add codex` write
their MCP entry under `CLAUDE_CONFIG_DIR` / `CODEX_HOME` when set, as Claude
Code, Codex and the hooks read it. Other readers and writers of the same
files still use the default paths only, so on a device that sets either
variable they look at a file the tool does not read:

- `cli/src/doctor.ts` — `readClaudeLaika(home)` reads `~/.claude.json`.
- `cli/src/agent-launcher-service.ts` — `isToolEntry(readClaudeLaika(home))`,
  the "Claude Code is launcher-ready" check.
- `cli/src/agent-hooks.ts` — hook install writes `~/.claude/settings.json`
  and `~/.codex/hooks.json` (`paths.claude`, `paths.codex`, `codexToml`),
  run by `tool add` and `laika agent hooks on|off`.
- `cli/src/agents.ts` (`USER_CONFIG.codex`) and `cli/src/connect.ts` — what
  `connect` and its detection read and write for Codex.

## Acceptance criteria

- [ ] Each site above reads or writes under `CLAUDE_CONFIG_DIR` /
      `CODEX_HOME` when set (`claudeConfigFile`, `codexConfigFile`,
      `claudeJsonPath(home, env)`), or the task file records why a site
      must not.
- [ ] A test per site, red when that site reads the default path instead.

## Notes

- SHELL, `cli/` only. Found while doing LAI-1108 (h); deliberately not done
  there, which named `tool add` only.
