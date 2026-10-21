---
id: LAI-854
title: 'A list with two blank lines between items opens as Markdown with a notice that names nothing'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-849
status: backlog
---

## Goal

When the rich editor refuses `- a\n\n\n- b` (two blank lines between list
items), the notice says what would change, not only that something would.

## What was measured (on LAI-849's branch, 2026-10-21)

- The parser reads the two blank lines as an **empty paragraph inside the
  first item**: `listItem` → `paragraph "a"`, `paragraph` (empty).
- `toMarkdown` cannot write that item back, so it throws `UnwritableMarkdown`
  ("“ab” would not read back as typed…") with the draft `- a\n\n- b`.
- `explain` diffs the source against that draft. After the stated
  normalisation they are equal, so the notice falls back to "The rich editor
  would not write it back exactly." The same holds on `master`; LAI-849 did not
  change it.

## Acceptance criteria

- [ ] The notice for this shape names the real difference, for example that
      the two blank lines would become one and make the list read differently,
      or the editor opens it rich if that is safe.
- [ ] A test for it, red before the change.
- [ ] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency.
