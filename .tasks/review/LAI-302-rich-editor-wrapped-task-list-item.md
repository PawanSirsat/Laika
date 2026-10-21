---
id: LAI-302
title: 'A task-list item wrapped onto an indented line opens as Markdown, because TipTap reads its second line as a block'
area: web
assignee: strelka
priority: p3
depends-on: []
discovered-from: LAI-853
status: review
started: 2026-10-21T18:13:37Z
finished: 2026-10-21T18:24:00Z
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

- [x] Each row above opens in the rich editor as one paragraph, or the
      Result says why it must stay refused.
- [x] A save of an untouched wrapped task item is byte-for-byte the text as
      stored.
- [x] A change to any non-blank character is still refused (LAI-827,
      LAI-849, LAI-853).
- [x] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency. Overriding the task list's
  tokenizer in `extensions.ts` is the likely shape; the item's writer must
  then also write a wrapped item that the tokenizer reads back.
- LAI-853's tests assert both rows open as `source`
  (`markdown-bridge.test.ts`, *a wrapped task-list item stays Markdown*);
  this task flips that test.

## Result

Both rows open in the rich editor as one paragraph, and so does the
LAIKA-439 body (LAI-624) as stored: an untouched save is byte-for-byte the
text (`toMarkdown(…, opening) === IMPORTED`).

- `server/web/src/routes/screens/task/editor/extensions.ts` — the task list
  gets its own `markdownTokenizer` (`tokenizeTaskList`): an item's paragraph
  is its first line and every line under it that starts no block of its own
  (`startsBlock`), indented or lazy, as CommonMark reads it. Past the
  paragraph it is the library's logic (indented lines are nested blocks,
  dedented by `indent + 2`). The task item's writer indents a wrapped line
  of its text under the text, past the box (6 spaces), as task files do.
- `server/web/src/routes/screens/task/editor/markdown-bridge.ts` —
  `startsBlock` exported for the tokenizer. `splitUnits` strips the blank
  line the task list's `raw` starts with (an edit to the paragraph above
  *any* task list wrote two extra blank lines; pre-existing, measured with
  the library's own tokenizer). `firstDifference` compares blocks with
  `unindentContinuations` applied, so a notice names the refusing line, not
  a forgiven wrap — **this is LAI-313**, which can be closed against this
  branch.
- Conservative on purpose: a line that *might* start a block (`2.`, `|`,
  `<`, a definition) ends the paragraph even where CommonMark would continue
  it; those documents behave as before.

Depends on PR #13 (LAI-853) and PR #24 (LAI-312), merged into this branch.

## Evidence

- Red: `0df5b2c9` (tests only) — `node --test
  test/routes/screens/task/editor/markdown-bridge.test.ts` in `server/web`:
  exit 1, 141 collected, 13 fail. Green on `f8b6d09a`: exit 0, 141/141.
- Mutations (each restored, files cmp-identical after): no wrapped lines →
  12 fail; block starts swallowed → 10 fail; writer flush left → 1 fail (the
  edited-item test); LAI-313 change undone → 1 fail (the LAI-313 test);
  `splitUnits` strip undone → 1 fail (the edit-beside test).
- Root gate on `f8b6d09a`, under `/tmp/laika-root-gate.lock`: `pnpm test`
  exit 0 (server 3386 passed / 10 skipped; server/web 2736/2736; cli 533
  pass of 535, 0 fail), `pnpm lint` exit 0, `pnpm format` exit 0. No flake
  (LAI-304/307/308) hit.

