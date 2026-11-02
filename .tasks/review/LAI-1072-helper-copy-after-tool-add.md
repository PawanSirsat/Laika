---
id: LAI-1072
title: 'Helper copy after tool add: names a check the browser does not show, and doctor sends a V3 tool to agent login'
area: cli
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-1069
status: review
finished: 2026-11-02T02:42:56Z
started: 2026-11-02T02:20:43Z
---

Seen in the LAI-1069 walkthrough
(`docs/acceptance/LAI-1069-developer-access-v3.md`, steps 8 and 15):

1. `laika tool add claude-code` ends *"Then ask it to call laika_whoami — the
   browser ticks "Tool request seen"."* The browser's check is named
   **"Claude Code connected"**; nothing called *Tool request seen* appears.
2. `laika doctor`, for a `tool add` credential the board refuses (the tool was
   disconnected in the browser), says *"log the agent in again"*. A V3 tool is
   fixed by **Reconnect** on Devices and a new `laika tool add … --exchange`;
   `laika agent login` is the older path.
3. Question for the owner, not a decision here: the web's *Automatic* tile
   for Claude Code promises *"Credential, MCP entry and session hooks"*, but
   `tool add` wrote only the credential and hooks, and `laika doctor` then
   reports *"no tool on this machine has a laika MCP entry"*. If
   `laika-claude` supplies the MCP server at launch, the tile and doctor
   should say so; if not, `tool add` is missing a step.

## Acceptance

- [x] `tool add`'s closing line names the check the browser shows.
- [x] `doctor`'s ACTION for a refused `source: "tool-add"` credential points
      to Reconnect on Devices; for a `laika agent login` credential it keeps
      today's advice.
- [x] Item 3 answered on the card; any change it needs is its own task
      (the tile is `server/web/`).
- [ ] cli typecheck, eslint, prettier exit 0; PR into `master`, CI green.

## Submitted (2026-11-02)

**Item 3 went further than this file asks, on the owner's direction** (the
polly dispatch for this batch): rather than only answering, `tool add`
now installs Claude Code's Laika MCP entry — user-scope `mcpServers.laika` in
`~/.claude.json` whose `headersHelper` reads `~/.laika/agents/claude-code.json`
— and the web catalog (`server/web/.../tool-catalog.ts`) and the CLI both say
**MCP set up by hand** with the exact step for Cursor, Gemini CLI and VS Code.
The answer is on the card (LAIKA-926). Re-walked: §8 R5–R8, R10, R12. CI box
open until the PR's run is in.
