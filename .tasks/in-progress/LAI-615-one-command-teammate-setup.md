---
id: LAI-615
title: One-command setup — laika-claude launcher and installer
area: plugin
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-614
status: in-progress
started: 2026-09-21T09:15:00Z
---

## Goal

A teammate with no Laika checkout and no knowledge of the plugin can connect a
Claude Code session to the board - with live presence - in one command they
can remember. Before this, connecting meant either a raw `claude mcp add` with
a pasted token (no presence, because the heartbeat hooks never load) or a
`--plugin-dir` invocation naming an absolute path that exists only on the
owner's machine, with the owner's own token exported beside it.

## Acceptance criteria

- [x] `plugin/scripts/laika-claude` starts Claude Code with the plugin
      attached, in the caller's own directory, passing every flag through
      unchanged, and resolves the plugin directory from its own location
      rather than a hardcoded path.
- [x] Settings load from `~/.laika/env` (mode 600) - never from the repo, so
      a token cannot be committed.
- [x] Unconfigured launch fails with an instruction, not a stack trace.
- [x] `plugin/scripts/install.sh` asks for the board URL and the person's OWN
      token, stores them, and installs a `laika-claude` shell command;
      re-running replaces rather than stacks the alias.
- [x] Both scripts pass `sh -n`; the launcher verified end to end against a
      stub `claude` (correct --plugin-dir, flags preserved).

## Notes / context

- Owner-directed, 2026-09-21: "they don't have this root folder ... can we
  make this cmd more good and clear and simple". Claim written at the start of
  the work rather than before it, same deviation shape as LAI-605.
- Deliberately NOT a published marketplace plugin: that is a bigger decision
  (versioning, distribution) and the git-clone route works today.
- Presence needs the plugin's hooks; `claude mcp add` alone can never show a
  session on Capacity. That is the whole reason this exists.
