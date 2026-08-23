---
id: LAI-031
title: Stray tool artifacts make `pnpm format` red in a clean checkout
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-023
status: backlog
---

## Goal

`.playwright-mcp/` appeared at the repo root — YAML page snapshots written by the
Playwright MCP server. It is untracked, so it commits nothing, but `pnpm format`
globs `**/*.yml` and reports it, which makes a green gate look red for a reason
that has nothing to do with the code.

The gate is only worth keeping repo-wide (LAI-001 review) if red means something.
This is the second time a non-source directory has broken it; `docs/design/` was
the first (LAI-026).

## Acceptance criteria

- [ ] `.gitignore` ignores tool scratch directories, `.playwright-mcp/` included.
- [ ] `pnpm format` is green in a checkout where such a directory exists.
- [ ] The entry says what it is, so nobody later "cleans up" an unexplained rule.

## Notes / context

Found during the LAI-023 review: `pnpm format` was red on
`.playwright-mcp/page-2026-08-23T23-16-14-371Z.yml`, which no task had touched.

**Needs a root `.gitignore` edit** — outside any builder's area, so whoever takes
this needs PM to name the file first (CLAUDE.md §1). **Granting it here:** this
task authorises editing exactly `.gitignore`, root, nothing else.

Prefer ignoring the specific directory over a broad `.*` pattern — a blanket rule
would also hide `.prettierignore`, `.nvmrc` and friends, which are tracked
deliberately.

No new dependencies.
