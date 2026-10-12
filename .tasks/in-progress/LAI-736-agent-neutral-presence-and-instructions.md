---
id: LAI-736
title: 'Laika works with any coding agent — server half: MCP activity is presence, the client is recorded per token, the server tells agents how to work'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-12T06:04:37Z
---

## Goal

Made on the **owner's direct instruction** (one-agent mode, HANDOVER §4), on
branch `build-agent-server` cut from `master` 486cd83. This is the server half
of "Laika works with any coding agent"; the web half (Connect screen, presence
rendering) is a separate builder's.

Today presence only comes from `POST /api/v1/heartbeats`, which only Claude
Code's plugin hook sends, so Codex, Cursor, OpenCode, Gemini CLI and Omnigent
agents never show as live, and `/mcp` tells a connecting agent nothing about how
to work the board. When this is finished, any authenticated `/mcp` request
counts as agent presence, the server records which client a token connects
with, the Connect screen can detect *the* token it just minted, and every agent
gets the working rules from the server itself.

## Acceptance criteria

- [ ] `tokens` gains nullable `last_mcp_at` (unix ms), `last_client` (slug) and
      `last_client_name` (raw `clientInfo.name`, control/bidi characters
      stripped, at most 64 characters), through a generated Drizzle migration
      that only `ADD`s columns.
- [ ] Every authenticated `/mcp` request updates `last_mcp_at`, throttled to
      60 s like `last_used_at`; an `initialize` request stores
      `params.clientInfo.name` and its slug, writing only when changed. Neither
      is ever used for authorisation.
- [ ] A pure, exported, unit-tested slug normaliser maps client names
      case-insensitively to the slugs in an exported `AGENT_CLIENTS` const, and
      falls back to the token name's first word, then `'other'`.
- [ ] `presenceNow` / `capacityNow` count a token with `last_mcp_at` inside the
      five-minute window as a live agent session with no heartbeat; one entry
      per user (newest wins); a heartbeat still supplies repo/branch/task, an
      MCP-only session has repo/branch `null`; each entry carries `client` and
      `clients`; `active_sessions` counts distinct token ids across heartbeats
      ∪ MCP activity; `presence_enabled` and every existing hiding rule hold.
- [ ] `GET /api/v1/tokens` (own) returns `last_mcp_at`, `last_client`,
      `last_client_name`.
- [ ] `initialize` on `/mcp` returns agent-neutral `instructions`, and
      `laika_whoami` carries the same text as `how_to_work`; the tool list is
      unchanged.
- [ ] D-076 appended to `docs/DECISIONS.md`; SPEC §4.10, §7, §9.3 and line 14
      amended.
- [ ] `POST /api/v1/heartbeats`, its strict `{repo, branch}` body and its tests
      are unchanged (D-005).
- [ ] Every new test shown to fail without the change; the gate (`pnpm test`,
      `pnpm lint`, `pnpm format`) exits 0.

## Notes / context

Files this task may touch: `server/src/**`, `server/test/**`, `docs/SPEC.md`,
`docs/DECISIONS.md`, this file, `logs/chief-2026-10-12.md`. Nothing under
`server/web/`. No new dependencies.

Measured `clientInfo.name` values: Claude Code `claude-code`; Gemini CLI
`gemini-cli-mcp-client`; cursor-agent `Cursor`; OpenCode `opencode`; Omnigent
`mcp` (generic); Codex unverified; VS Code likely `Visual Studio Code`.
