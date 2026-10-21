---
id: LAI-853
title: 'The rich editor refuses a list item wrapped onto an indented second line'
area: web
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-849
status: in-progress
started: 2026-10-21T13:32:36Z
---

## Goal

A list item written over two lines, the second indented under the first (how
agents and this repo's own task files hard-wrap), opens in the rich editor,
or the decision to keep refusing it is written down with the reason.

## What was measured (on LAI-849's branch, 2026-10-21)

`openDocument` in `server/web/src/routes/screens/task/editor/markdown-bridge.ts`:

| Source | Opens | Reason given |
| --- | --- | --- |
| `- a long item that\n  wraps onto a second line` | Markdown | rewrite line 2: `  wraps…` as `wraps…` |
| `1. a step that\n   wraps` | Markdown | rewrite line 2: `   wraps` as ` wraps` |
| `- [ ] a criterion that\n      wraps like a task file` | Markdown | rewrite line 2: `      wraps…` as `` ```  `` |
| `A paragraph that\nwraps` | rich | |

The writer drops or changes the continuation line's indentation. That is
whitespace inside a block, which LAI-849 deliberately did not forgive: it
forgives only blank lines between top-level blocks. The notice already names
the line correctly.

The task-list row is worse than a refusal of layout. The round trip writes a
code fence, so TipTap's task-list tokenizer appears to read the indented
continuation as an indented code block inside the item, where CommonMark
reads it as the paragraph's continuation. Check what the reading view
(react-markdown) renders for the same text before deciding anything.

## Acceptance criteria

- [ ] Each row above opens in the rich editor, or the Result says why that
      row must stay refused.
- [ ] A save of an untouched wrapped item is byte-for-byte the text as
      stored; an edit to another block leaves the wrapped item as written.
- [ ] A change to any non-blank character is still refused (LAI-827,
      LAI-849), with a test proven by a mutation.
- [ ] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency.
