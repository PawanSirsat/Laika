---
id: LAI-132
title: A 57 KB screenshot is committed at the repo root
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-053
status: backlog
---

## Goal

`sprints-light.png` (57 KB) sits at the repository root, tracked, since
`cc1a8a1`.

**It is mine and I am sorry for it.** It is a Playwright screenshot from
verifying LAI-083: I passed a `filename` to the MCP screenshot tool, which wrote
it relative to the MCP server's working directory — CHIEF's `Laika/` worktree, not
mine — where it was swept up by a later merge. Nothing references it and nothing
should.

## Acceptance criteria

- [ ] `sprints-light.png` is deleted.
- [ ] `.gitignore` covers the shape so the next one cannot be committed either.
      `*.png` at the root would do it; note that `docs/design/` may legitimately
      gain images later, so anchor the rule (`/*.png`) rather than making it
      global.
- [ ] Consider whether `.playwright-mcp/` should be ignored too — it holds
      snapshots and screenshots from every review pass and is in the same
      position.

## Notes / context

Repo-root config is CHIEF's (CLAUDE.md §1, LAI-001), which is why this is a task
rather than a deletion.

The lesson for me, recorded so I do not repeat it: **the MCP screenshot tool
writes relative to its own cwd, not the caller's worktree.** I have since stopped
passing `filename` and drive my own headless Chromium into my scratchpad instead,
which cannot land in the repo at all.
