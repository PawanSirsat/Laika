---
id: LAI-302
title: 'A task-list item wrapped onto an indented line opens as Markdown, because TipTap reads its second line as a block'
area: web
assignee: strelka
priority: p3
depends-on: []
discovered-from: LAI-853
status: in-progress
started: 2026-10-21T18:13:37Z
---

## Goal

A task-list item written over two lines, the second indented under the
first — how this repo's own task files write their criteria — opens in the
rich editor as one paragraph, as the reading view shows it, or the decision
to keep refusing it is written down.

## What was measured (on LAI-853's branch, 2026-10-21, built on Strelka)

`@tiptap/extension-list` 3.32.0's task-list `markdownTokenizer` takes only an
item's first line as its text (`mainContent` is `match[4]` of a one-line
pattern) and hands the lines under it to `parseIndentedBlocks` as nested
blocks:

| Source | TipTap reads | react-markdown + remark-gfm renders |
| --- | --- | --- |
| `- [ ] a criterion that\n      wraps like a task file` | paragraph, then a **code block** | one paragraph, `a criterion that\nwraps like a task file` |
| `- [ ] a criterion that\n  wraps` | **two paragraphs** | one paragraph |

LAI-853 made the bullet and ordered rows open rich; these stay Markdown,
deliberately, because opening them would show in the editor a code block or a
second paragraph that the board does not show — and an edit to the item would
save that.

## Acceptance criteria

- [ ] Each row above opens in the rich editor as one paragraph, or the
      Result says why it must stay refused.
- [ ] A save of an untouched wrapped task item is byte-for-byte the text as
      stored.
- [ ] A change to any non-blank character is still refused (LAI-827,
      LAI-849, LAI-853).
- [ ] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency. Overriding the task list's
  tokenizer in `extensions.ts` is the likely shape; the item's writer must
  then also write a wrapped item that the tokenizer reads back.
- LAI-853's tests assert both rows open as `source`
  (`markdown-bridge.test.ts`, *a wrapped task-list item stays Markdown*);
  this task flips that test.
