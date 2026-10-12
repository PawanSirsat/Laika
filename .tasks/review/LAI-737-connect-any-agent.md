---
id: LAI-737
title: 'Laika connects to any coding agent — client half: Connect picks the agent, the CLI writes its config, presence names it'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
finished: 2026-10-12T06:53:27Z
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

- [x] Connect opens with an agent picker: primary agents first, the rest under
      *More*, plus *Any MCP client* and *No MCP (REST/CLI)*. Neutral monogram
      tiles (REPORT §Logos: no third-party marks), keyboard and screen-reader
      operable as a radio group, both themes, 1366 and 390 wide. The choice is
      kept in `?agent=` and in `localStorage`.
- [x] Steps adapt to the agent: the token's default name is `<slug> on <OS>`;
      step 2 shows that agent's config file and scope and/or its one-line add
      command, referencing `LAIKA_TOKEN` wherever the client expands env vars,
      and an inline-token variant only where it cannot, with a warning. Kiro,
      Claude Desktop, JetBrains AI Assistant and Zed get the `mcp-remote`
      bridge with `--allow-http`. Antigravity says *beta / not yet verified*.
      Claude Code keeps the plugin + `laika-claude` path as recommended.
- [x] No snippet carries the token unless it is the inline variant, under test.
- [x] Step 4 watches the minted token's `last_mcp_at` (own tokens list) and
      names the client; without a minted token it falls back to presence and
      says so. The timeout names that agent's likely causes.
- [x] The project block is agent-neutral and its target file follows the agent
      (AGENTS.md, CLAUDE.md, GEMINI.md, `.cursor/rules/laika.mdc`,
      `.github/copilot-instructions.md`, …). It never carries a token.
- [x] Presence (Capacity, the Agents chip, PresencePerson, Activity) shows the
      agent's mark and name, and an MCP-only session with no repo reads
      *connected via <agent>*.
- [x] `laika connect <agent> [--project]` and `laika connect --list`: stores
      URL + token once in `~/.laika/env` (0600), merges the agent's config
      (JSON parse-merge, TOML block append, YAML file), backs the original up
      once to `<file>.bak`, refuses unparseable JSON. `laika whoami` reports
      which agents are configured. No new dependency.
- [x] `install.sh` keeps its stdin contract and points non-Claude agents to
      `laika connect <agent>`; wording in plugin/README, TokensScreen,
      `laika-status.sh` and the root README is agent-neutral.
- [x] Every new test shown to fail first; the gate (`pnpm test`, `pnpm lint`,
      `pnpm format`) run from the worktree root, each exit code reported.

## Notes / context

Files this task may touch: `server/web/**`, `cli/**`, `plugin/**`,
`README.md`, this file, `logs/chief-2026-10-12.md`. Nothing under
`server/src/` (LAI-736's). No new dependencies.

Server contract (LAI-736): own `TokenView` gains `last_mcp_at`, `last_client`,
`last_client_name`; `PresenceEntry` gains `client`, `clients`; an MCP-only
session has no repo/branch.

## Builder notes (review)

**Two-owner change, §4.4 step 1: this half is submitted red on exactly three
assertions**, all of which read `server/src` and turn green when LAI-736
(`build-agent-server`, b733198) is merged first. Quoted from
`pnpm -C server/web test` on this branch:

- `server/web/test/api/agent-clients.test.ts` — `every server slug is known
  here` / `every slug here is one the server can send`: ENOENT on
  `server/src/auth/agent-clients.ts`, which only LAI-736 creates.
- `server/web/test/api/presence.test.ts` — `the same fields, neither side
  inventing one`: the client declares `client` and `clients`.
- `server/web/test/api/view-type-drift.test.ts` — `the client declares nothing
  the server does not send`: `TokenView.last_mcp_at`, `last_client`,
  `last_client_name`.

Proof they go green: a scratch tree of b733198's `server/src` plus this
branch's `server/web` ran those three files at **26/26, exit 0**. No exemption
was added.

Mirrored from b733198, not from a description of it: `AGENT_CLIENTS` is the same
21 slugs in the same order, and `PresenceEntry` and `TokenView` match field for
field, optionality included.

`server/test/tooling/build.test.ts` failed twice in the root run with "built
server never became healthy". Run on its own it passed 15/15, exit 0. This
branch changes nothing under `server/`.

`logs/chief-2026-10-12.md` also exists on `build-agent-server`, so the merge
hits an add/add conflict on it. Keep both entries.
