---
id: LAI-1233
title: 'Space bar: remove the Agents chip and its presence read; the ⋯ item gets a gear'
area: web
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-17T11:10:00Z
finished: 2026-11-17T11:45:00Z
---

## Goal

The owner, with a screenshot of the space bar's right end (`Agents 0`, `⋯`):
remove the Agents chip, with the API call behind it, and in the ⋯ menu show a
settings icon followed by *Space settings*.

The chip toggled `?agent=true`, which the board's Filter panel already offers
as *Agent-created only*, and it was the reason `SpaceLive` read `/presence` on
every tab of every space. Activity is the one other reader of that presence.

Base: local `ui-round9` @ e0d48e5d. Web only, no server changes, no new
dependencies. Local commits only, not pushed.

## Acceptance criteria

- [x] No Agents chip in the space bar on any tab; `SpaceTopBar` takes no
      props.
- [x] `SpaceLive` no longer reads `/presence`; the board makes no presence
      request. Activity reads it through `usePresence()` (mount, then one
      read per burst of live frames, as before).
- [x] `?agent=true` still filters the board, reached from Filter →
      *Agent-created only*.
- [x] The ⋯ menu's item is a gear icon then *Space settings*; its accessible
      name and href are unchanged.
- [x] `agentCount` / `agentsLive` and their tests are deleted (no other
      caller); the chip's CSS is removed.
- [x] Tests: the chip's tests are replaced by "no chip, no presence read on
      the board" and "Activity still reads presence"; the menu test checks
      the gear.
- [x] Typecheck, eslint, prettier, the token guards (bar the pre-existing
      board-toolbar spacing failure on `ui-round9`) and the affected browser
      suites exit 0.
