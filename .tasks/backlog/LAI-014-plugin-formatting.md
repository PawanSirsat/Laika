---
id: LAI-014
title: Bring plugin/ under the repo formatter
area: plugin
assignee: unclaimed
priority: p3
depends-on: [LAI-001]
discovered-from: LAI-001
status: backlog
---

## Goal

`pnpm format` now checks every `.ts/.js/.json/.yaml/.css/.html` file in the repo
(LAI-001). One file fails it: `plugin/.claude-plugin/plugin.json`. Builder-A
cannot fix it — `plugin/` is Builder-B's area (CLAUDE.md §1) — so the repo-wide
format check is red through a boundary, not through a bug.

## Acceptance criteria

- [ ] `pnpm format` passes with no findings under `plugin/`.
- [ ] The fix is `pnpm format:fix` (or an equivalent Prettier run) — no hand
      re-indentation, and no change to the *meaning* of any file.
- [ ] Any future JSON/YAML added under `plugin/` is Prettier-clean at commit
      time.

## Notes / context

Discovered while finishing LAI-001. The only current finding is the `keywords`
array in `plugin/.claude-plugin/plugin.json`, which Prettier collapses to one
line under `printWidth: 100`. It is cosmetic — nothing is broken today.

Prettier config lives at `/.prettierrc` and is shared; do not add a second
config under `plugin/`. If a file under `plugin/` genuinely must keep hand
formatting, say which and why, and it gets an ignore entry instead — but that is
a root-config change and therefore a task for whoever owns root config.

No new dependencies.
