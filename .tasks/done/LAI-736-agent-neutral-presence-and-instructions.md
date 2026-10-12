---
id: LAI-736
title: 'Laika works with any coding agent — server half: MCP activity is presence, the client is recorded per token, the server tells agents how to work'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: done
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
      MCP-only session has repo/branch **absent** (not `null`: the web's
      `hasLocation` is `repo !== undefined`, and absent already means "working,
      location not told", LAI-438); each entry carries `client` and
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

## Review round 1 fixes

Against the reviewer's notes on b733198. Each new test was red before its fix,
or, where it pins behaviour that already held, red under a named mutation.

- **B1** — a heartbeat on a revoked or expired token is no longer presence and
  no longer counts in Capacity (`liveHeartbeat` in `services/presence.ts`, a
  left join to `tokens`); a cookie heartbeat is unchanged. The heartbeat
  index-range test (LAI-722) still passes. D-076 item 1 says so.
- **B2** — expired-token test; red under `gt(tokens.expiresAt, now * 0)`.
- **N1** — `last_mcp_at` is not stamped while `presence_enabled` is off; the
  client name and slug still are. SPEC §4.9 and §9.3, D-076 item 5. Consequence
  recorded there: with presence off, Connect cannot detect a new token by
  `last_mcp_at`.
- **N2** — D-076 item 4 says why MCP presence needs no per-user opt-in.
- **N3** — a throwing recorder is caught and logged as `mcp.record_failed`;
  the tool result still returns (test injects `recordUse`).
- **N4** — pinned: a newer cookie heartbeat does not hide the agent's
  `client` (red under `sessions[0]`); merged entries are ordered by newest
  session (red with the sort removed); an unknown stored slug reaches the wire
  as `null` (red with `asAgentClient` bypassed).
- **N5** — `cleanClientName` strips `\p{C}`, U+2028 and U+2029.
- **N6** — `MCP_INSTRUCTIONS` comment names D-076's clients and says the
  instruction-blind ones are reached through `laika_whoami`'s description.
- **N7** — SPEC §4.9: "from the last `initialize` that named an agent".
- **N9** — bare `copilot` is `other`; `Code - OSS` is `vscode`.
- **N10** — the criterion above now says repo/branch are absent, with why.

Gate after the last code edit: `server/` alone `pnpm test` exits 0 (2283/2283
test cases); root `pnpm lint` 0, `pnpm format` 0; root `pnpm test` exits 1. The
web suite alone shows 1633 pass and 2 fail, the two drift checks quoted above,
unchanged. In the root run `test/tooling/build.test.ts` also timed out under
load ("built server never became healthy"), 2 cases on the first run and 4 on
the second; alone it passes 15/15.

## Accepted

2026-10-12, by polly (orchestrator), for release 5. reviewed: LAI-736 approved
round 2 on 1b98195; LAI-737 approved round 2 on 7d69539 + follow-ups 19dff2f;
owner's direct instruction. Integrated on `build-release-5` by §4.4:
`build-agent-server` merged first, then `build-agent-connect`; the only
conflict was `logs/chief-2026-10-12.md`, resolved by keeping every entry from
both sides in timestamp order. The two review nits are fixed in the same
integration: D-076 item 5 now names Connect's fallback, and the LAI-736 log
entry's presence-off cost claim carries an appended correction.
