---
id: LAI-026
title: '`pnpm format:fix` silently edits other sessions'' areas'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-003
status: backlog
---

## Goal

`pnpm format:fix` runs Prettier over the whole repo. Run from any worktree it
rewrites files in **every** area, so a builder tidying their own code silently
modifies another session's — precisely what D-008's worktree split exists to
prevent. Make the fixing half of the formatter respect ownership without
narrowing the checking half.

## Acceptance criteria

- [ ] `pnpm format` still checks the **whole** repo (PM's LAI-001 review decision:
      "a formatter that only looks where it is already clean stops being a check").
- [ ] `pnpm format:fix` no longer writes outside the area of whoever ran it, or
      it warns loudly enough that the edit cannot pass unnoticed.
- [ ] A builder can fix their own formatting in one command without staging a
      cross-area diff.
- [ ] Whatever shape is chosen is written down where builders will see it —
      `CLAUDE.md` §4 or the root `package.json` scripts.

## Notes / context

Discovered during LAI-003, by doing it: `pnpm format:fix` from
`Laika-builder-a/` reformatted `plugin/.claude-plugin/plugin.json` — Builder-B's
file, and the exact file LAI-014 exists to fix. It was caught by `git status`
before the commit and reverted, but only because the diff happened to be looked
at. The check itself is fine and PM was right to keep it repo-wide; it is the
`--write` variant that crosses the line.

Plausible shapes, in rough order of preference:

1. Per-area scripts — `format:fix:server`, `format:fix:plugin` — with the bare
   `format:fix` removed. Blunt, obvious, no cleverness.
2. `format:fix` writes only files already modified in the working tree
   (`git diff --name-only` filtered through Prettier), which is what someone
   almost always means by "fix my formatting".
3. Leave it, and rely on staging explicit paths. Weakest: it depends on every
   session noticing every time.

**This needs a root `package.json` edit**, which is outside a builder's area —
LAI-001's scope exception was granted to that task only. Whoever takes this needs
PM to name the file in the task first, or PM makes the change.

No new dependencies.
