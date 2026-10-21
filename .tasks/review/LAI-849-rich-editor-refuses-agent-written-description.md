---
id: LAI-849
title: 'The rich editor refuses an agent-written description, saying it would rewrite line 7 as an empty line'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-827
status: review
started: 2026-10-21T06:52:18Z
finished: 2026-10-21T07:27:41Z
---

## Goal

An agent-written description that renders correctly opens in the rich editor.
When the editor genuinely cannot keep a description intact, the notice says
what would change.

## What the owner saw (2026-10-21, 08:58)

The task panel for an agent-written task in another project showed:

> This Markdown stays as Markdown. The rich editor would rewrite line 7:
> '- <the first item of a bulleted list>…' as ''

and the editor toolbar was greyed out. The owner's words: *"why I'm not able
to edit here using the tool"*. The screenshot is on this machine at
`~/.omnigent/artifacts/2880e3a1c1e14ba7a4b20fbd670faa4a`; it is not in the
repo.

(The quoted list item is the owner's text from another project and is
elided here: this repo is public.) The notice comes from LAI-827's
round-trip guard:
`server/web/src/routes/screens/task/editor/markdown-bridge.ts:730` and
`server/web/src/routes/screens/task/editor/RichEditor.tsx:513` (line numbers as
of `master` `d36d2ee5`).

## Hypothesis: unverified, prove or refute it first

The guard converts the stored Markdown into the editor's document and back,
and refuses when the result differs. If it compares the two texts line by line
by position, one inserted blank line shifts every later line, and the first
mismatch reads as *"line N becomes ''"*.

A bullet list placed directly under a paragraph with no blank line between them
is common in agent-written Markdown, is legal CommonMark (a list may interrupt
a paragraph), and is a likely source of exactly one inserted blank line.

If that is right, the guard refuses a change that alters no rendered content,
then describes it wrongly. If it is wrong, find what really changes: the cause
may be the serializer losing real content, and then the fix belongs in the
bridge, not the guard.

## Acceptance criteria

- [x] The root cause is stated in the Result section with evidence: the input
      shape, what the round trip produced, and the code that compared them.
- [x] A regression test reproduces the refusal on `master` with a
      **synthetic** description of the same Markdown shape, and passes after
      the fix. **This repo is public: no text, task key, or name from the
      owner's other projects goes into any fixture, commit, log or PR.**
- [x] The description shape the owner hit opens in the rich editor. If the
      round trip genuinely loses content that cannot be kept, the Result says
      why and the notice says exactly that instead.
- [x] A description whose round trip differs from the original **only in blank
      lines between blocks** opens in the rich editor.
- [x] A description whose round trip would change, drop or reorder any
      non-blank text is still refused. LAI-827's protection against rewriting
      text nobody touched stays, and a test proves it: break the guard and
      watch **that** assertion go red, with the edit confirmed to have landed.
- [x] Opening a description in the rich editor and leaving without an edit
      saves nothing; the stored text is byte-for-byte unchanged.
- [x] When the guard does refuse, the notice names the real difference (for
      example *"adds a blank line before line 7"*, or the text that would be
      lost), not a position-shifted line shown as `''`.
- [x] The repo-root gate exits 0: `pnpm test`, `pnpm lint` and `pnpm format`,
      each redirected to its own file with its own `$?` (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency: TipTap is already pinned at 3.32.0 by
  LAI-827.
- CI runs on Linux with wider fonts. A browser test that asserts visible text
  width or wrapping can pass on the Mac and fail on CI; LAI-831 failed CI twice
  that way. Assert on text and state, not layout.
- Out of scope: LAI-840 (adding acceptance criteria where there are none),
  which waits on the owner.

## Result

Filed as **LAI-849**: LAI-848 was already taken on `LAI-841-sprint-stats-flake`.
Branch `LAI-849-editor-round-trip-guard`. Card LAIKA-640.

### Root cause: the hypothesis held, and there was a second difference behind it

The owner's description was read read-only through the Laika MCP tools and
run through the bridge on this machine. It is not quoted anywhere in the repo.
Its shape, one letter per line, is `PPBPBPLLLLLL`: paragraph lines, then a
paragraph at line 6 with a six-item bullet list directly under it.

1. **A blank line, which the old notice reported as `''`.**
   - **Input shape.** A list directly under a paragraph's last line, with no
     blank line between them. That is legal CommonMark. The lexer reads a
     `paragraph` token (its `raw` ends `…:\n`) and then a `list` token,
     measured with `bridge.manager.instance.lexer`.
   - **What the round trip produced.** The same text, with one blank line
     added above the list. `toMarkdown` joins top-level blocks with `\n\n`.
   - **The code that compared them** (as of `master` `d36d2ee5`).
     `openDocument` (`markdown-bridge.ts:753`) required
     `normaliseMarkdown(written) === normaliseMarkdown(text)`, which never
     forgives an added blank line. `explain` (`markdown-bridge.ts:726-731`)
     then compared the two normalised texts **by array index**. The added line
     shifted every later line, so the first "difference" was source line 7,
     the list's first item, set against the blank line now in its place:
     `as ''`.
2. **Behind it, a real change that LAI-827 refuses by design.** Past its 57th
   character, the list's first item spells `<` and `>` as `&lt;` and `&gt;`
   (so does its last item). The parser decodes them, and the faithful writer
   spells the `<` as `\<`. That reads the same and is stored differently, which
   is the `'a &amp; b'` case LAI-827 refuses. With only the blank line forgiven,
   the notice named the right line, but `clip()` cut both versions at 57
   characters, so they read the same.

**Evidence.** Three made-up descriptions of these shapes (the repo is public)
are red on `master`'s bridge and pass after the fix.

- On `master` the notice is `The rich editor would rewrite line 7: “- A book
  handed in after hours waits on the returns trolley.” as “”.` That is the same
  line number and the same `''` as the owner's screenshot.
- Test-first commit `123fb403`: 14 of 81 test cases fail on `master`'s bridge,
  and every refusal LAI-827 keeps already passes.
- The full-shape case with an entity (`ENTITIES`) and the long-line case also
  fail on `master` with `… as “”`. That run swaps in `master`'s bridge plus an
  unused `sameMarkdown` stub, so the test file can load.

**So, criterion 3.** The shape opens in the rich editor. The owner's actual
description also holds an entity spelling that the editor cannot keep, so it
still opens as Markdown, and the notice now says exactly that:

> The rich editor would rewrite line 7: “…&lt;…&gt;…” as “…\<…>…”

That is abbreviated here; the real notice shows the owner's words around the
entity. Whether to keep or forgive that spelling is the owner's decision →
**LAI-855** (p1).

### Fix (`server/web/` only, no dependency)

- **`sameMarkdown`** (exported) is now the round-trip check: the stated
  normalisation, **plus blank lines between top-level blocks**, and nothing
  else.
  - `topLevelBlocks` splits a text into exact slices of itself at the lexer's
    tokens. It returns `null` if anything other than whitespace lies outside a
    block, or if a block starts mid-line. In that case only the strict
    comparison applies.
  - Each block must equal its counterpart after `normaliseMarkdown`. A loose
    list made tight, `*` for `-`, `_` for `*`, a setext heading, an entity
    respelt, or a changed word is still refused.
  - It does not recurse into quotes, where a `>` line is text: `> para\n> - x`
    stays refused.
- **The notice is a line diff.** `hunks` is an LCS diff, taken block by block
  when both texts have as many blocks, so a forgiven blank line is never the
  line named.
  - Line numbers are the source's, as the Markdown view shows them
    (`normalisedLines`); `normaliseMarkdown` is now built on it, with the same
    output.
  - It names a line that would be **rewritten**, **dropped** or **added**
    (and where), or a blank line added or removed inside a block.
  - A rewritten line too long to show whole is cut to **the same window on
    where it changes** (`excerpts`), from a word's start.
- **An untouched save** was already byte-for-byte, because `plan` copies
  untouched blocks from the source. The new tests prove it for this shape.
  `RichEditor.tsx` is unchanged.

### Files changed

- `server/web/src/routes/screens/task/editor/markdown-bridge.ts`
- `server/web/test/routes/screens/task/editor/markdown-bridge.test.ts`:
  - The owner's shape opens rich, and an untouched save is the text as
    stored. An edit elsewhere leaves the paragraph and its list as written.
  - Nine block-under-a-paragraph shapes open rich.
  - Four non-blank changes, and the entity case, are still refused.
  - The wording of the reason: rewrite, remove a blank line, drop, add, source
    line numbers, a long line's window.
  - `sameMarkdown` is tested directly.
- `server/web/test/browser/task-panel-editing.test.ts`, in Chromium:
  - The shape opens rich, with the toolbar enabled and no notice. Save and
    Escape without an edit send no `PATCH`, and the stored text is unchanged.
  - Markdown and back (the owner's click) stays rich, and the source view is
    the text as stored.
  - A version that spells `&lt;` stays Markdown, with a notice showing
    `&lt;branch&gt;` against `\<branch>`.
  - All three are red on `master`'s bridge.

### Mutation check (criterion 5)

`mutate.sh` restores from `HEAD` in a trap and confirms that each mutation
landed (`git diff --numstat` 1/1) before running anything. It was run on the
final commit.

- **M1**, the per-block comparison replaced by `true`: the 4 "still refused"
  tests, the entity test and 2 `sameMarkdown` tests go red. Example: the test
  at `markdown-bridge.test.ts:428`, whose assertion on line 429 fails with
  expected `'source'`, actual `'rich'`.
- **M2**, the guard in `openDocument` switched off: the 4 "still refused"
  tests and the entity test go red.

The file is byte-clean afterwards (`git diff --quiet`).

### Filed

- **LAI-855** (p1): an entity the editor would respell (`&lt;` → `\<`). This is
  what still keeps the owner's description in Markdown. Three options are set
  out there for the owner.
- **LAI-853** (p2): a list item wrapped onto an indented second line is
  refused, because the writer drops the indentation, and a wrapped task item
  reads back as code. The owner's description has no wrapped items.
- **LAI-854** (p3): `- a\n\n\n- b` opens as Markdown with "would not write it
  back exactly". The parser puts an empty paragraph in the item, and the
  behaviour is unchanged from `master`.
