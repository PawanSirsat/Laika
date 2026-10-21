---
id: LAI-854
title: 'A list with two blank lines between items opens as Markdown with a notice that names nothing'
area: web
assignee: strelka
priority: p3
depends-on: []
discovered-from: LAI-849
status: review
started: 2026-10-21T21:52+05:30
finished: 2026-10-21T17:26:34Z
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

- [x] The notice for this shape names the real difference, for example that
      the two blank lines would become one and make the list read differently,
      or the editor opens it rich if that is safe.
- [x] **The second layout's notice says what happens to “B”.**
      `Intro:\n- a\n<ws>\nB`, with U+00A0 and with U+3000, still opens as
      Markdown, and its notice names **line 4, “B”**, and says the rich
      editor would make it **a paragraph of its own instead of part of the
      list item**. A notice that only names a blank line it would add
      (*"would add a blank line after line 1"*) does not meet this: it is
      true and says nothing about the effect. Today's notice, "The rich
      editor would not write it back exactly.", fails it.
- [x] A test for each layout's notice, red before the change.
- [ ] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency.

## Result

Built on Strelka. Both layouts still open as Markdown; each notice now names a
line and what happens to it.

| Source | Notice before | Notice now |
| --- | --- | --- |
| `- a\n\n\n- b` | The rich editor would not write it back exactly. | The rich editor would remove the 2 blank lines before line 4: “- b”. |
| `- a\n\n\n- b\n- c` | (the same) | (the same as the row above) |
| `Intro:\n- a\n<U+00A0>\nB` | The rich editor would not write it back exactly. | The rich editor would make line 4, “B”, a paragraph of its own instead of part of the list item above it. |
| `Intro:\n- a\n<U+3000>\nB` | (the same) | (the same as the row above) |

**Layout 1 is not safe to open rich.** CommonMark reads `- a\n\n\n- b` as a
**loose** list, and the editor writes every list tight (`- a\n- b`), which the
reader renders differently (`<li><p>a</p></li>` against `<li>a</li>`). One
blank line between items is already refused the same way, with *"would remove
the blank line before line 3"* (asserted since LAI-849). Two blank lines now
get the same notice, with the real count.

**What changed** (`server/web/src/routes/screens/task/editor/markdown-bridge.ts`):

1. `parseMarkdown` drops an empty paragraph that is not the only child of its
   parent and not at the top level (`withoutEmptyParagraphs`). The lexer reads
   two blank lines between items as an empty paragraph in the first item.
   Markdown has no such thing: the reader shows none and nothing can write
   one. Without it the editor's document is the reader's, so the write is a
   real draft (`- a\n- b`) and the diff finds the blank lines. Top-level empty
   paragraphs are left alone: `blocksOf` already ignores them, so the narrower
   rule changes nothing that was opening rich.
2. `inWords` counts a removed run of blank lines from the source's line
   numbers. The normalisation keeps one blank line of a run, which made "the
   blank line" wrong for two.
3. `explain`, when `firstDifference` finds nothing, asks `leftContainer`
   before giving the generic notice. It looks at the lexer's top-level blocks
   (`TextBlock` now carries the token `type`). It names the first non-blank
   line of a paragraph that sits **directly** under a list or quote and starts
   with a line `trim()` empties but CommonMark does not (U+00A0, U+3000). That
   is the line the reader keeps in the item, as a lazy continuation, and the
   editor would write as a paragraph of its own. After a real blank line the
   item has already ended, and the notice does not say otherwise (asserted).

**Not changed:** no test that existed before changed, and every one of them
still passes, so none of their documents moved between rich and Markdown. That
is what was measured, not a proof for every document: a refused document whose
only obstacle was an empty paragraph inside an item would now open rich.

**Filed:** LAI-306 (discovered-from: LAI-854). `Intro:\n- a\n\n<U+00A0>\nB`
still gets the generic notice: there `B` is not part of the item, and why
the document is refused at all is not yet known. LAI-308: a cli load flake
seen in this gate. A third flake is LAI-307, which LAI-857 filed first.

**Merging with LAI-853 (PR #13).** A trial `git merge --no-commit --no-ff
origin/LAI-853-editor-wrapped-list-item` (`8692850d`) conflicts in
`markdown-bridge.ts` only, in two places. Both are from the two branches each
adding a JSON pass before `nodeFromJSON` in `parseMarkdown`. Resolution: keep
both functions and compose them:
`withoutLineIndents(withoutEmptyParagraphs(bridge.manager.parse(markdown)), schema)`.
The test file merges by itself. Resolved like that, the combined branch's
editor tests pass 124/124 and `tsc` exits 0. The merge was then aborted.

## Evidence

Tests: `server/web/test/routes/screens/task/editor/markdown-bridge.test.ts`,
one new `describe`, *a notice that named nothing names the line (LAI-854)*:
6 test cases from 4 `test()` calls (two of them in a U+00A0/U+3000 loop).

**Red before.** The tests alone, on `master`'s code, commit `9fc93aad`:
`node --test test/routes/screens/task/editor/markdown-bridge.test.ts` → exit 1,
`# tests 99 / # pass 95 / # fail 4`. All four tests then present failed. The
guard *after a blank line…* was added later, after a mutation survived, and
passes on both sides, as a guard must.

**Green after.** The same command at `39dba834` → exit 0, 101/101. All three
editor test files (`node --test "test/routes/screens/task/editor/*.test.ts"`)
→ exit 0.

**Mutations.** Each was an anchored replace that refuses unless its anchor
matches exactly once, with a checksum proving the file changed, the same test
file run, and the file restored and checksummed back.

| Mutation | Exit | Fails |
| --- | --- | --- |
| no `withoutEmptyParagraphs` in `parseMarkdown` | 1 | *read as no paragraph at all*, *two blank lines … names them* |
| a run of blank lines named as one (`run > 1` → `run > 99`) | 1 | *two blank lines … names them* |
| no `leftContainer` | 1 | both *a U+00A0 / U+3000 line under a list item* |
| no adjacency check in `leftContainer` | 1 | both *after a blank line … is not said to* (added for this) |
| drop empty paragraphs at the top level too | **0** | none. The top-level guard keeps the change narrow; nothing asserts it |

**Gate** (repo root, worktree `Laika-854`, under `/tmp/laika-root-gate.lock`,
each command to its own file with its exit on its own line). Five runs. LINT
and FMT were 0 on every run after the lint fix (`39dba834`; run 1 had one
lint error, mine, which that commit fixed). **TEST never exited 0.** Each time
it was one timing test, a different one in a different workspace, outside
this change, and each passes alone:

| Run | Load (1 min) at start → end | TEST | LINT | FMT | The one failure | Alone |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 6.0 → 23.0 | 1 | 1 | 0 | cli `activity-sync.test.ts:717` reads an empty lock | exit 0, 43/43 |
| 2 | 21.8 → 25.5 | 1 | 0 | 0 | web `task-markdown.test.ts:226` link popup (LAI-307) | exit 0, 4/4 |
| 3 | 17.1 → 21.8 | 1 | 0 | 0 | server `sprints.test.ts:623` 5000 ms (LAI-304) | exit 0, 43/43 |
| 4 | 14.2 → 30.2 | 1 | 0 | 0 | web `task-markdown.test.ts:226` (LAI-307) | (as run 2) |
| 5 | 12.7 → 24.5 | 1 | 0 | 0 | server `sprints.test.ts:623` (LAI-304) | (as run 3) |

In runs 1, 2 and 4, `pnpm -r` stopped at the failing workspace, so `server` did
not finish (LAI-480). In runs 3 and 5 every workspace finished: `server/web`
2696/2696, `cli` 533 pass / 0 fail of 535, `server` 3385 passed / 1 failed /
10 skipped. The load was other processes on the machine; nothing here added
any. `task-markdown.test.ts:226` fails at the link click, before any bridge
code runs: the bridge only runs when the text is clicked afterwards.

**So the fourth criterion is not ticked.** The gate has not exited 0 on this
tree. It needs a quieter machine, or LAI-304 and LAI-307 fixed.
`server/test/tooling/task-file-state.test.ts` was re-run alone after the last
filing: exit 0, 11/11.
