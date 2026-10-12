---
id: LAI-737
title: 'Laika connects to any coding agent — client half: Connect picks the agent, the CLI writes its config, presence names it'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-12T06:18:47Z
---

## Goal

Made on the **owner's direct instruction** (one-agent mode, HANDOVER §4), on
branch `build-agent-connect` cut from `master` 486cd83. This is the client half
of "Laika works with any coding agent"; the server half is LAI-736 on
`build-agent-server`, built in parallel. The two land together by §4.4.

Today the Connect screen only knows Claude Code, and its live check passes on
any agent session of the reader's — including one that was already running
before they minted anything. When this is finished, Connect lets a developer
pick their agent (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, VS Code,
Antigravity, Omnigent, Hermes and the rest), hands them that agent's own config
from the verified research in `/tmp/agent-client-configs/REPORT.md`, proves
*the token it just minted* connected, and `laika connect <agent>` writes the
config for them without clobbering anything.

## Acceptance criteria

- [ ] Connect opens with an agent picker: primary agents first, the rest under
      *More*, plus *Any MCP client* and *No MCP (REST/CLI)*. Neutral monogram
      tiles (REPORT §Logos: no third-party marks), keyboard and screen-reader
      operable as a radio group, both themes, 1366 and 390 wide. The choice is
      kept in `?agent=` and in `localStorage`.
- [ ] Steps adapt to the agent: the token's default name is `<slug> on <OS>`;
      step 2 shows that agent's config file and scope and/or its one-line add
      command, referencing `LAIKA_TOKEN` wherever the client expands env vars,
      and an inline-token variant only where it cannot, with a warning. Kiro,
      Claude Desktop, JetBrains AI Assistant and Zed get the `mcp-remote`
      bridge with `--allow-http`. Antigravity says *beta / not yet verified*.
      Claude Code keeps the plugin + `laika-claude` path as recommended.
- [ ] No snippet carries the token unless it is the inline variant, under test.
- [ ] Step 4 watches the minted token's `last_mcp_at` (own tokens list) and
      names the client; without a minted token it falls back to presence and
      says so. The timeout names that agent's likely causes.
- [ ] The project block is agent-neutral and its target file follows the agent
      (AGENTS.md, CLAUDE.md, GEMINI.md, `.cursor/rules/laika.mdc`,
      `.github/copilot-instructions.md`, …). It never carries a token.
- [ ] Presence (Capacity, the Agents chip, PresencePerson, Activity) shows the
      agent's mark and name, and an MCP-only session with no repo reads
      *connected via <agent>*.
- [ ] `laika connect <agent> [--project]` and `laika connect --list`: stores
      URL + token once in `~/.laika/env` (0600), merges the agent's config
      (JSON parse-merge, TOML block append, YAML file), backs the original up
      once to `<file>.bak`, refuses unparseable JSON. `laika whoami` reports
      which agents are configured. No new dependency.
- [ ] `install.sh` keeps its stdin contract and points non-Claude agents to
      `laika connect <agent>`; wording in plugin/README, TokensScreen,
      `laika-status.sh` and the root README is agent-neutral.
- [ ] Every new test shown to fail first; the gate (`pnpm test`, `pnpm lint`,
      `pnpm format`) run from the worktree root, each exit code reported.

## Notes / context

Files this task may touch: `server/web/**`, `cli/**`, `plugin/**`,
`README.md`, this file, `logs/chief-2026-10-12.md`. Nothing under
`server/src/` (LAI-736's). No new dependencies.

Server contract (LAI-736): own `TokenView` gains `last_mcp_at`, `last_client`,
`last_client_name`; `PresenceEntry` gains `client`, `clients`; an MCP-only
session has no repo/branch.
