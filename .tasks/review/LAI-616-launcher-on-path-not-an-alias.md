---
id: LAI-616
title: laika-claude installs on PATH, and survives being a symlink
area: plugin
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-615
status: review
finished: 2026-09-22T08:20:32Z
started: 2026-09-22T08:15:00Z
---

## Goal

`laika-claude` works the moment the installer finishes, in the terminal the
person already has open. LAI-615 installed it as a shell alias, and the owner
hit `zsh: command not found: laika-claude` twice in a terminal opened before
the alias existed - an alias only exists in interactive shells that have
sourced the rc since it was added. A symlink in a PATH directory has none of
those conditions.

The symlink then exposed a second defect: the launcher derived the plugin
directory from `dirname "$0"`, which through a symlink names the symlink's own
directory. Measured: `--plugin-dir /Users/…/.local` - a path that does not
exist, passed to claude without comment.

## Acceptance criteria

- [x] The installer prefers a symlink in the first writable PATH directory
      (`~/.local/bin`, `~/bin`, `/usr/local/bin`), creating `~/.local/bin` and
      adding it to PATH when none qualifies, and keeps the alias only as the
      fallback for a machine with no writable candidate.
- [x] The launcher resolves symlinks before deriving the plugin directory -
      a `readlink` loop, since BSD `readlink` has no `-f`.
- [x] A missing or moved plugin fails with a named message, not a silent
      `--plugin-dir` pointing at nothing.
- [x] Verified in a sandbox HOME end to end: installer run non-interactively,
      symlink created, `~/.laika/env` at mode 600, and the launcher invoked
      THROUGH the symlink resolves the real plugin directory and passes flags.

## Notes / context

- Owner-directed fix, 2026-09-22; claim written at the start of the work.
- The owner's own machine was fixed by hand first (symlink + patched launcher)
  because they were blocked; this task is what makes it true for everyone else.
