---
id: LAI-736
title: 'Laika works with any coding agent — server half: MCP activity is presence, the client is recorded per token, the server tells agents how to work'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-12T06:04:37Z
finished: 2026-10-12T06:25:03Z
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

- [x] `tokens` gains nullable `last_mcp_at` (unix ms), `last_client` (slug) and
      `last_client_name` (raw `clientInfo.name`, control/bidi characters
      stripped, at most 64 characters), through a generated Drizzle migration
      that only `ADD`s columns.
- [x] Every authenticated `/mcp` request updates `last_mcp_at`, throttled to
      60 s like `last_used_at`; an `initialize` request stores
      `params.clientInfo.name` and its slug, writing only when changed. Neither
      is ever used for authorisation.
- [x] A pure, exported, unit-tested slug normaliser maps client names
      case-insensitively to the slugs in an exported `AGENT_CLIENTS` const, and
      falls back to the token name's first word, then `'other'`.
- [x] `presenceNow` / `capacityNow` count a token with `last_mcp_at` inside the
      five-minute window as a live agent session with no heartbeat; one entry
      per user (newest wins); a heartbeat still supplies repo/branch/task, an
      MCP-only session has repo/branch `null`; each entry carries `client` and
      `clients`; `active_sessions` counts distinct token ids across heartbeats
      ∪ MCP activity; `presence_enabled` and every existing hiding rule hold.
- [x] `GET /api/v1/tokens` (own) returns `last_mcp_at`, `last_client`,
      `last_client_name`.
- [x] `initialize` on `/mcp` returns agent-neutral `instructions`, and
      `laika_whoami` carries the same text as `how_to_work`; the tool list is
      unchanged.
- [x] D-076 appended to `docs/DECISIONS.md`; SPEC §4.10, §7, §9.3 and line 14
      amended.
- [x] `POST /api/v1/heartbeats`, its strict `{repo, branch}` body and its tests
      are unchanged (D-005).
- [x] Every new test shown to fail without the change; `pnpm lint` and
      `pnpm format` exit 0, and `pnpm test` is red **only** on the two web
      drift checks quoted below (CLAUDE.md §4.4, the web half's to turn green).

Added mid-task on the owner's direct instruction (client research, 2026-10-12),
before submission:

- [x] The normaliser also knows `zed`, `cline`, `roo`, `continue`, `kiro`,
      `goose`, `amp`, `junie`, `warp`, `claude-desktop`; a weak name (`mcp`,
      `hermes-probe`, empty) never replaces a stored client other than `other`.
- [x] Antigravity's `server/discover` gets JSON-RPC `-32601` and `initialize`
      still works after it; `GET`, `HEAD` and `DELETE` on `/mcp` get `405` with
      `Allow: POST` and a JSON body, never the SPA.
- [x] `instructions` is at most 2,048 characters with the must-follow rules in
      the first 512; the rules are also in the `start_working`, `create_task`
      and `finish_task` descriptions; no tool renamed.
- [x] A `401` on `/mcp` says whether the header was missing, empty or an
      unexpanded placeholder, and never echoes the value presented.

## Notes / context

Files this task may touch: `server/src/**`, `server/test/**`, `docs/SPEC.md`,
`docs/DECISIONS.md`, this file, `logs/chief-2026-10-12.md`. Nothing under
`server/web/`. No new dependencies.

Measured `clientInfo.name` values: Claude Code `claude-code`; Gemini CLI
`gemini-cli-mcp-client`; cursor-agent `Cursor`; OpenCode `opencode`; Omnigent
`mcp` (generic); Codex unverified; VS Code likely `Visual Studio Code`.

## Submitted red, per CLAUDE.md §4.4

The server half cannot be green alone: the web drift checks compare server
types with `server/web/src/api/`, and their exemption lists are in
`server/web/`, which this task may not touch. `pnpm test` exits 1 with exactly
these two failures (web `# pass 1633`, `# fail 2`; server 2274/2274; cli 98/0):

1. `server/web/test/api/presence.test.ts:76` — *"the same fields, neither side
   inventing one"*: the server's `PresenceEntry` has `client` and `clients`,
   the client's does not.
2. `server/web/test/api/view-type-drift.test.ts:321` — *"no server field is
   missing from its client type"*:
   `TokenView.last_client is served and TokenView does not declare it`,
   and the same for `TokenView.last_client_name` and `TokenView.last_mcp_at`.

The web half (Connect screen and presence) turns both green by declaring the
fields.

## Deviations from the brief

- **An MCP-only presence entry has `repo` and `branch` absent, not `null`.**
  The web client's `hasLocation` is `entry.repo !== undefined`, and the
  server's contract since LAI-438 is "absent, not empty". `null` would make
  every MCP-only entry claim a location.
- **The placeholder `401` applies to REST as well as `/mcp`**, because it is
  produced where every token is resolved (`resolveTokenActor`); §6.1 says the
  two auth paths are identical. The missing/empty messages are `/mcp`'s only.
- **`server/discover` needed no code**: the SDK already answers `-32601`. The
  test pins it.
- **No index on `tokens.last_mcp_at`.** The brief allowed only `ADD COLUMN`;
  the tokens table is a handful of rows per person.
