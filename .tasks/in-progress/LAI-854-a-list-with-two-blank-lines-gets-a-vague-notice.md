---
id: LAI-854
title: 'A list with two blank lines between items opens as Markdown with a notice that names nothing'
area: web
assignee: strelka
priority: p3
depends-on: []
discovered-from: LAI-849
status: in-progress
started: 2026-10-21T21:52+05:30
---

## Goal

When the rich editor refuses `- a\n\n\n- b` (two blank lines between list
items), the notice says what would change, not only that something would.
The same holds for a second list layout, which LAI-849's review round 1
left with the same generic notice.

## What was measured (on LAI-849's branch, 2026-10-21)

- The parser reads the two blank lines as an **empty paragraph inside the
  first item**: `listItem` → `paragraph "a"`, `paragraph` (empty).
- `toMarkdown` cannot write that item back, so it throws `UnwritableMarkdown`
  ("“ab” would not read back as typed…") with the draft `- a\n\n- b`.
- `explain` diffs the source against that draft. After the stated
  normalisation they are equal, so the notice falls back to "The rich editor
  would not write it back exactly." The same holds on `master`; LAI-849 did not
  change it.
- **The second layout** (LAI-849's done file, *Review round 1*, item 1 and
  its *Known* note): a bullet list directly under a paragraph, with no blank
  line between them, whose item is followed by a line of nothing but Unicode
  white space, U+00A0 or U+3000, and then a paragraph:
  `Intro:\n- a\n<U+00A0>\nB`.
  It **must** open as Markdown, and since `7874d59f` it does, because
  micromark reads `B` as a lazy continuation of the item and the lexer reads
  it as a new paragraph. But its notice is the generic "The rich editor would
  not write it back exactly." (`markdown-bridge.ts:1015`) and names no line:
  the notice is built from the lexer's blocks, which differ from the editor's
  output here only by blank lines. `markdown-bridge.test.ts:451` asserts that
  it opens as `source`, and nothing asserts its notice. Re-measured on
  `master` at `0e1f6d38` (CHIEF, 2026-10-21, `openDocument` called directly):
  U+00A0 and U+3000 each give exactly that notice, and the plain-space
  control opens rich.
- **What the rich editor would really do to it** (same probe, `toMarkdown`
  and the reading view's micromark): no line's text changes, it only adds
  blank lines, `Intro:\n- a\n<ws>\nB` → `Intro:\n\n- a\n\n<ws>\nB`. The
  effect is that **line 4, “B”, leaves the list item.** micromark reads the
  source as `<li>a\n<ws>\nB</li>` and the written text as `<li>a</li>`
  followed by `<p><ws>\nB</p>`: a paragraph of its own.

## Acceptance criteria

- [ ] The notice for this shape names the real difference, for example that
      the two blank lines would become one and make the list read differently,
      or the editor opens it rich if that is safe.
- [ ] **The second layout's notice says what happens to “B”.**
      `Intro:\n- a\n<ws>\nB`, with U+00A0 and with U+3000, still opens as
      Markdown, and its notice names **line 4, “B”**, and says the rich
      editor would make it **a paragraph of its own instead of part of the
      list item**. A notice that only names a blank line it would add
      (*"would add a blank line after line 1"*) does not meet this: it is
      true and says nothing about the effect. Today's notice, "The rich
      editor would not write it back exactly.", fails it.
- [ ] A test for each layout's notice, red before the change.
- [ ] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency.
