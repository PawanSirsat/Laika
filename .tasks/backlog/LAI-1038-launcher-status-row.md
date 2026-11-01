---
id: LAI-1038
title: 'Launcher status row per device in Developer access › Agents › Your devices'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-558]
discovered-from: LAI-558
status: backlog
---

## Goal

D-117 item 7: show a read-only *Launcher* row per device in *Developer access ›
Agents › Your devices* — enabled?, last start, running count — once the board
has data to show.

## Why it is not built yet

The launcher (LAI-558) keeps its state on the device only
(`~/.laika/launcher/status.json`, `audit.jsonl`). The board has no field for it,
and §5.1 forbids building the screen on stubbed data. This needs, in order:

1. **CORE:** a minimal, read-only report — e.g. the launcher sending
   `{ enabled, running, last_start_at }` with the agent's own token on its
   existing poll, kept per agent/device, never a command channel. A SPEC §6.4
   row and its `can()` action.
2. **SHELL:** the CLI sending it (`cli/src/agent-launcher.ts`), and the row in
   `server/web/` with Playwright evidence in both themes.

## Acceptance criteria

- [ ] The board stores only the three read-only facts; nothing on it can start,
      stop or configure a launcher (D-117: no general runner).
- [ ] The row shows "Launcher: off" when a device has never reported.
- [ ] Repo-root gate exits 0.
