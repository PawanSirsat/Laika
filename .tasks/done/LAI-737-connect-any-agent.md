---
id: LAI-737
title: 'Laika connects to any coding agent — client half: Connect picks the agent, the CLI writes its config, presence names it'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: done
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

**Follow-up to LAI-736 round 1 (server 1b98195).** With presence off the
server no longer stamps `last_mcp_at`. Step 4 now counts the minted token as
connected on any of these:
- `last_mcp_at` after the mint;
- a recorded client (`last_client` / `last_client_name`), which is written
  only on an MCP `initialize`, with presence on or off;
- only while presence is off, `last_used_at` after the mint.

The page reads `presence_enabled` from `GET /org` once per watch. Unit and
browser tests cover presence off, plus a control that a bare use with presence
on still does not count. A mutation that hard-wires presence on turns the
browser test red. The three drift checks pass 26/26 against 1b98195 as well.

## Review round 1 fixes

Each fix started from a test that failed; the commits are 4419328, 2625323
and 39c55fa.

**Blocking**
1. **Presence off.** Step 4 counts the minted token as connected when
   `last_mcp_at` moved after the mint (`by: 'mcp'`), or when the token has a
   recorded client (`by: 'client'`), which only an MCP `initialize` writes,
   with presence on or off. While presence is off, `last_used_at` after the
   mint also counts (`by: 'use'`). The page says when a weaker signal proved
   it. Covered by unit tests and a browser test.
2. **Codex.** `codexLaikaState` recognises `[mcp_servers.laika]` and its
   sub-tables, inline `laika = {…}` under `[mcp_servers]`,
   `mcp_servers = { laika … }`, and dotted keys, quoted or not. Any other
   mention of `laika` counts as `unsure`, so the file is left alone and the
   block is printed. The fixtures assert the file is byte-identical and that
   a minimal duplicate-table check passes. The comment is fixed.
3. **Bridge one-liner.** It is now
   `LAIKA_AUTH="Bearer $LAIKA_TOKEN" npx … 'URL' … --header 'Authorization:${LAIKA_AUTH}'`.
   A test runs it through `bash -n` and a bash stub, which receives the
   literal `${LAIKA_AUTH}` and has `LAIKA_AUTH=Bearer <token>` in its env.
4. **Kiro and Junie** say "user scope only". The project paths are gone.
5. **Zed** text is honest: both the inline form and the bridge keep the
   token in settings.json. A new variant reads `Bearer ${LAIKA_TOKEN}` from
   Zed's inherited environment and is marked not verified. REPORT names
   `--header-file` but not its format, so it is not used.

**Also**
- The web "by hand" block writes `~/.laika/env` (0700 dir, 0600 file) and
  appends the CLI's source line to the shell profile once. A test runs it in
  bash: the profile never holds the token, and the line is added only once.
  The CLI rc line is checked the same way.
- Files that hold the token (`~/.laika/env`, Antigravity's config, and its
  backup) are written to a 0600 temp file and renamed into place. A test
  asserts the inode changes.
- `LAIKA_URL` and `LAIKA_TOKEN` in the environment win over `~/.laika/env`
  and update it.
- `--project` and `--dir` back up to `~/.laika/backups/`, never into the repo.
- VS Code leads with `${env:LAIKA_TOKEN}`; `${input:}` moved to an
  alternative.
- The Antigravity beta note cites issue 233. It is written without `#`
  because `theme-single-source.test.ts` reads `#233` as a colour literal.
- Junie is the same on the page and in the CLI: direct inline config plus
  the AI Assistant bridge.
- Roo is pointed to `.roo/rules`. Claude Desktop is told to paste into its
  Project instructions. Zed, Hermes and Warp name the files that override
  AGENTS.md.
- Claude Code's env in a remote header and Gemini's single-quote expansion
  are marked not verified.
- Cline, Roo and Continue say VS Code must be started from a terminal (or the
  variable set system-wide).
- UI:
  - setup-block labels are no longer upper-cased; only the path tokens wrap
    mid-name;
  - Capacity stacks its panels below 40rem, and a test asserts nothing is
    clipped at 390px;
  - presence chips say the agent's name in visually hidden text;
  - the Agents chip says "N people with agent sessions, using …" for screen
    readers and in its title, with a separator before the marks;
  - collapsing More keeps the chosen agent's tile shown;
  - an unknown `?agent=` is removed from the URL;
  - `code --add-mcp` is JSON-escaped and shell-quoted on the page and in the
    CLI, and tested with a URL containing `'`.

**Re-review follow-ups (approved at 7d69539):** the step 4 note now reads "calling this board" for No MCP and mentions presence off only when the org has it off (40307f5, 5ceab9f); codex detection is tested directly with six mutations killed, is quote-aware, skips multi-line strings and ignores laika outside `mcp_servers`; `~/.laika/env` is made 0600 before the token is written; Capacity's summary strip wraps at 390 (e54b243); the 17 screenshots are retaken from this build.

## Accepted

2026-10-12, by polly (orchestrator), for release 5.

reviewed: LAI-736 approved round 2 on 1b98195; LAI-737 approved round 2 on 7d69539 + follow-ups 19dff2f; owner's direct instruction

Integrated on `build-release-5` by §4.4:
`build-agent-server` merged first, then `build-agent-connect`; the only
conflict was `logs/chief-2026-10-12.md`, resolved by keeping every entry from
both sides in timestamp order. The two review nits are fixed in the same
integration: D-076 item 5 now names Connect's fallback, and the LAI-736 log
entry's presence-off cost claim carries an appended correction.
