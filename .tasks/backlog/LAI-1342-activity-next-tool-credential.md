---
id: LAI-1342
title: 'laika activity: when the first tool credential is refused or expired, try the next tool for that board'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-1325]
discovered-from: LAI-1325
status: backlog
---

## Goal

From review-1325 on PR #376 (F4), filed rather than done there.

LAI-1325 has activity fall back to this machine's own tool credential, picking
`~/.laika/agents/<tool>.json` in a fixed order: Claude Code's first, then the others by name,
for the board. It takes the **first** one it finds. If that one is expired or refused — a cloud
token past `expires_at`, or one revoked when the tool was re-added elsewhere — `on`, `status`
and `sync` stop with a 401, even when another tool on the same machine holds a working
credential for that board.

## What to build

- **Prefer a usable credential.** Skip one whose saved `expires_at` has passed, and on a `401`
  from the board try the next tool for the same board.
- **Keep the rules LAI-1325 set:**
  - the same-board check stays strict;
  - a personal token in `~/.laika/env` still comes first;
  - the file only, never `LAIKA_AGENT_TOKEN`.
- **Say which one was used:** `on` and `status` name the tool whose credential actually worked.

## Acceptance criteria

- [ ] With Claude Code's credential expired and Codex's working for the same board, `on` and
      `sync` succeed with Codex's, and say so.
- [ ] A 401 on the first tries the next once, never in a loop, and never another board's.
- [ ] Tests cover the expired, refused and only-one cases.
