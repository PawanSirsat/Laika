---
id: LAI-1072
title: 'Helper copy after tool add: names a check the browser does not show, and doctor sends a V3 tool to agent login'
area: cli
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-1069
status: in-progress
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

- [ ] `tool add`'s closing line names the check the browser shows.
- [ ] `doctor`'s ACTION for a refused `source: "tool-add"` credential points
      to Reconnect on Devices; for a `laika agent login` credential it keeps
      today's advice.
- [ ] Item 3 answered on the card; any change it needs is its own task
      (the tile is `server/web/`).
- [ ] cli typecheck, eslint, prettier exit 0; PR into `master`, CI green.
