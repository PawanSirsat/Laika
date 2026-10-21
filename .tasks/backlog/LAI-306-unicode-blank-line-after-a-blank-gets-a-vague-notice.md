---
id: LAI-306
title: 'A U+00A0 line after a blank line under a list still opens with a notice that names nothing'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-854
status: backlog
---

## Goal

`Intro:\n- a\n\n<U+00A0>\nB` (and the U+3000 form) opens as Markdown with a
notice that says what would change, or opens rich if that is safe.

## What was measured (on LAI-854's branch, Strelka, 2026-10-21)

- `openDocument` gives "The rich editor would not write it back exactly."
- CommonMark ends the list item at the real blank line, so `<U+00A0>\nB` is a
  paragraph of its own already. LAI-854's *"a paragraph of its own instead of
  part of the list item"* notice is deliberately **not** given here (asserted:
  *after a blank line, a U+00A0 line does not continue the item, and is not
  said to*).
- The refusal comes from `sameMarkdown` falling back to the strict check
  whenever `hasUnicodeBlankLine` is true; the lexer's blocks then differ from
  the editor's output only by blank lines, so `firstDifference` finds nothing.
  It is not yet known whether anything other than blank lines would really
  change, so it is not known whether opening rich is safe.

## Acceptance criteria

- [ ] The notice for this shape names a line and what happens to it, or the
      document opens rich and an untouched save is the text as stored.
- [ ] A test for the notice (or the opening), red before the change.
- [ ] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency.
- `markdown-bridge.ts`: `explain`, `leftContainer`, `sameMarkdown`.
