---
id: LAI-853
title: 'The rich editor refuses a list item wrapped onto an indented second line'
area: web
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-849
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-21T13:32:36Z
finished: 2026-10-21T13:58:45Z
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

- [x] Each row above opens in the rich editor, or the Result says why that
      row must stay refused.
- [x] A save of an untouched wrapped item is byte-for-byte the text as
      stored; an edit to another block leaves the wrapped item as written.
- [x] A change to any non-blank character is still refused (LAI-827,
      LAI-849), with a test proven by a mutation.
- [x] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency.

## Result

Built on Strelka. Rows 1 and 2 open in the rich editor; row 3 stays Markdown
on purpose; row 4 already did.

| Source | Opens | Why |
| --- | --- | --- |
| `- a long item that\n  wraps onto a second line` | **rich** | the continuation's indentation is forgiven |
| `1. a step that\n   wraps` | **rich** | the same, and the stray space the lexer kept is gone |
| `- [ ] a criterion that\n      wraps like a task file` | Markdown | see below |
| `A paragraph that\nwraps` | rich | unchanged |

**The reading view, measured first** (react-markdown 10 + remark-gfm, rendered
with `react-dom/server`): every row is one item holding **one paragraph**,
`a long item that\nwraps onto a second line` and so on — including both
task-list shapes. `1. a\n  - b` renders as **two lists** (`<ol>` then `<ul>`),
where TipTap nests the `- b`.

**What changed** (`server/web/src/routes/screens/task/editor/markdown-bridge.ts`):

1. `parseMarkdown` drops the leading spaces and tabs of every line after the
   first in a non-code text block (`withoutLineIndents`) — what CommonMark
   does to a paragraph. The lexer left one of the three spaces under `1. `, so
   the editor held `a step that\n wraps`, a space the reader never shows, and
   its own text did not read back.
2. `sameMarkdown` forgives the indentation of a **paragraph continuation**
   (`unindentContinuations`): a line directly under a line of paragraph text
   (past any `>` and list markers and task box), where neither that line nor
   the one above starts a block of its own (heading, quote, list item, rule,
   setext underline, definition, fence, table row, HTML). Not inside code.
   After a blank line, a heading or a fence, or on a list-marker line,
   indentation is structure and still counts — `1. a\n  - b` stays Markdown.
   Only spaces and tabs at a line's start are removed, so a change to any
   non-blank character is still a change.

An untouched save copies the item byte for byte (LAI-849's unit copy); an
edited item is written by the editor, flush left, which reads back as the
same paragraph.

**Row 3 stays Markdown, and must for now.** `@tiptap/extension-list` 3.32.0's
task-list tokenizer takes only the item's first line as its text and hands
the lines under it to `parseIndentedBlocks`: at six spaces the editor holds a
**code block**, at two a **second paragraph**. The reading view shows one
paragraph either way. Opening it rich would show in the editor what the board
does not, and an edit to the item would save that. Making it open needs the
task list's tokenizer (and its writer) replaced in `extensions.ts` — filed as
**LAI-302** (discovered-from: LAI-853). The refusal is asserted
(`a wrapped task-list item stays Markdown`), so LAI-302 flips a named test.

**LAI-854 is unaffected**: `- a\n\n\n- b` and `Intro:\n- a\n<U+00A0>\nB`
open as Markdown with the same notice as before. One notice wording moved,
not its outcome: `> a quote\n  wraps` (a lazy quote continuation) still opens
as Markdown, and now says `as “> wraps”` where it said `as “>   wraps”`.

## Evidence

Tests: `server/web/test/routes/screens/task/editor/markdown-bridge.test.ts`,
two new `describe` blocks (14 new test cases, from 9 `test()` calls, some in
loops). No existing assertion changed. No browser test touched.

**Red before** — the tests alone on `bc039784`'s code (commit `fd85ac8a`):
`node --test test/routes/screens/task/editor/markdown-bridge.test.ts` → exit 1,
`# tests 109 / # pass 100 / # fail 9`: all five *opens rich…* cases, *no
stray space*, both *an edit to the paragraph above…*, and the positive
control. The guards (*a changed character*, *a rewrite on the wrapped line*,
*a list marker's indentation*, *after a blank line or a heading*, *a wrapped
task-list item stays Markdown*) pass on both sides, as they must.

**Green after** — same command on `a4595288` → exit 0, `# tests 109 / # pass
109 / # fail 0`.

**Mutations** (each applied to `markdown-bridge.ts` by an anchored replace that
refuses unless its anchor matches exactly once, the file then compared to the
original to prove it changed, the same test file run, and the file restored
and compared again):

| Mutation | Exit | Fails |
| --- | --- | --- |
| forgive a block-starting line (drop `!startsBlock(line)`) | 1 | *a list marker's indentation is structure* |
| forgive after a blank line (drop `above !== ''`) | 1 | *after a blank line or a heading* |
| forgive after a heading (drop `!startsBlock(above)`) | 1 | *after a blank line or a heading* |
| keep the lexer's indentation (drop `withoutLineIndents`) | 1 | 4: the ordered rows, *no stray space*, the ordered edit |
| also strip a `\` at a line's start — a non-blank character | 1 | *a changed character on the wrapped line is still a change* |
| no forgiveness (`layoutOf` = `normaliseMarkdown`) | 1 | 9: every *opens rich*, both edits, the positive control |

One mutation that did **not** go red, recorded so nobody reads it as cover:
reverting only `sameMarkdown`'s first comparison to `normaliseMarkdown` passes
(exit 0), because the block-by-block comparison under it uses the same
`layoutOf`. The first comparison is a fast path, not a separate guard.

**Gate** (repo root, worktree `Laika-853`, on Strelka, run once the
1-minute load fell below 20, after the last code edit; each to its own file,
each exit on its own line):

```
pnpm test > /tmp/853-gate.txt 2>&1; echo "TEST $?"   → TEST 0
pnpm lint > /tmp/853-lint.txt 2>&1; echo "LINT $?"   → LINT 0
pnpm format > /tmp/853-fmt.txt 2>&1; echo "FMT  $?"  → FMT  0
grep -E "Unhandled|Errors|Failed|not ok|✗" /tmp/853-gate.txt
  → two lines, both the test name "completeSetup and fieldErrors"; no failure
```

Counts from that run: `server/web` 2704 tests, 2704 pass, 0 fail; `server`
3386 passed, 10 skipped (167 files, 2 skipped); `cli` 535 tests, 533 pass,
0 fail. No load flake this run.

Only this section and the log were written after the gate; both are
Markdown. `server/test/tooling/task-file-state.test.ts`, which reads task
files, was re-run alone afterwards (see the log).

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #13.
