# editor-guard: 2026-10-21

A builder CHIEF dispatched for one task, in the temporary worktree
`Laika-editor-guard`, branch `LAI-849-editor-round-trip-guard`. It files from
CHIEF's block (D-089).

## 2026-10-21T07:28:07Z — LAI-849

**What changed**
- `.tasks/review/LAI-849-rich-editor-refuses-agent-written-description.md`:
  filed from CHIEF's LAI-848 draft, claimed `owner-direct`, Result written,
  moved to review.
- `server/web/src/routes/screens/task/editor/markdown-bridge.ts`:
  - `sameMarkdown` forgives blank lines between top-level blocks and nothing
    else. `topLevelBlocks` cuts exact slices of the text at the lexer's
    tokens, and refuses any gap that is not whitespace.
  - The notice is an LCS line diff (`hunks`), taken block by block, with the
    source's line numbers (`normalisedLines`).
  - A long rewritten line is cut to a window on the change (`excerpts`).
- `server/web/test/routes/screens/task/editor/markdown-bridge.test.ts`:
  - the regression (made-up text in the owner's shape);
  - nine block-under-a-paragraph shapes;
  - still-refused shapes and an entity case;
  - the wording of the reason;
  - `sameMarkdown` directly.
- `server/web/test/browser/task-panel-editing.test.ts`:
  - the shape opens rich, with the toolbar on;
  - Save and Escape without an edit send no `PATCH`;
  - Markdown and back stays rich;
  - the entity version stays Markdown, and its notice shows the change.
- `.tasks/backlog/LAI-853-…`, `LAI-854-…`, `LAI-855-…`: filed (below).

**Decisions**
- **LAI-849, not LAI-848.** LAI-848 was already taken on
  `LAI-841-sprint-stats-flake`, and every id from 800 to 848 was used. The
  branch was first cut as `LAI-848-editor-round-trip-guard`. CHIEF's
  correction renamed it to `LAI-849-editor-round-trip-guard` before anything
  was pushed, and the card was re-marked with `start_working` on the new name.
  No LAI-848 card exists, so there was nothing to correct there.
- **The draft was not copied verbatim.** It quoted the owner's line 7, which
  is text from another project, and the repo is public. The quote is elided in
  the task file: the dispatch's "no … text … in any … task file" outranked
  "verbatim".
- **Only blank lines between *top-level* blocks are forgiven.** The check does
  not recurse into containers. Inside a quote a `>` line is text, and
  forgiving it would also forgive lazy-continuation rewrites. So
  `> para\n> - x` stays refused, now with "would add “>” before line 2".
- **The texts are split by slicing the source at token positions**, not by
  joining the tokens' `raw`. A tokenizer whose `raw` dropped characters would
  otherwise hide a change. Anything else falls back to the strict check.
- **The entity respelling was left refused** (`&lt;` written as `\<`).
  LAI-827 refuses it by design (`'a &amp; b'`), and this task's criteria say
  a non-blank change stays refused. Keeping or forgiving it is the owner's
  call, so it went to LAI-855 with three options rather than into this fix.
- **`RichEditor.tsx`'s `unchanged` was left as it was.** I tried it on
  `sameMarkdown` and reverted it. The no-edit criterion already holds through
  `plan`'s verbatim copy, and the change would have dropped a blank line a
  person adds by hand in the Markdown view.

**Discovered**
- **The hypothesis held only for the first difference.** Read read-only, the
  owner's description has two problems, and the fix clears only the first:
  - the blank line above the list, which the old notice showed as `''`;
  - behind it, `&lt;…&gt;` past the 57th character of the list's first item,
    which the editor writes as `\<…>`. `clip()` then cut both versions to the
    same 57 characters, and they read alike.

  So the owner's own card **still opens as Markdown**, now with a notice that
  shows the entity. → LAI-855 filed (p1, discovered-from: LAI-849).
- A list item hard-wrapped onto an indented second line is refused, because
  the writer drops the indentation, and a wrapped task item reads back as a
  code fence. → LAI-853 filed (p2, discovered-from: LAI-849).
- `- a\n\n\n- b` parses with an empty paragraph inside the item. The notice
  names nothing, the same as on `master`. → LAI-854 filed (p3,
  discovered-from: LAI-849).
- **Finding the owner's card took a second pass.** The first read-only key
  search also required the description to *open with* its `Owner:` line, and
  missed the card. A substring match found it. When a search comes back
  empty, look at the match condition before widening the range.
- `pnpm install` warns "Ignored build scripts: better-sqlite3". That is
  harmless: 13.0.3 ships `prebuilds/` for darwin-arm64.
- A test-first red run for a test file that imports a new export fails to
  load, which is an imprecise red. Appending an unused stub of that export to
  the `master` copy gave assertion-level reds for the tests that do not call
  it.

**State**
In `.tasks/review/`. The gate, the PR and the card (LAIKA-640, to Review)
follow in this sitting; their exit codes are in the PR and the card's finish.

## 2026-10-21T08:38:49Z — LAI-849, review round 1

**What changed**
- `server/web/src/routes/screens/task/editor/markdown-bridge.ts`:
  - `BLANK` (CommonMark's blank) replaces the three `trim()` tests in
    `topLevelBlocks`;
  - `hasUnicodeBlankLine` makes `sameMarkdown` keep the strict result;
  - `hunks` weighs a line of words 2 and a blank line 1.
- `server/web/test/routes/screens/task/editor/markdown-bridge.test.ts`:
  - four still-refused cases (A and B, each with U+00A0 and U+3000), each
    with a plain-space control;
  - three notice tests pinning line 4: a definition and two `&nbsp;`
    paragraphs;
  - two comments reworded so they claim no more than they assert.
- `.tasks/review/LAI-849-…`: a "Review round 1" note in the Result. The
  criteria are unchanged.

**Decisions**
- **Both halves of the reviewer's fix for blocking 1, not one.** The guard in
  `sameMarkdown` is what catches case B. There the lexer's own split is not
  CommonMark's: it ends the item at the U+00A0 line, where micromark
  continues it lazily, so no gap test in `topLevelBlocks` can see it.
  Mutations agree: with the guard off, B goes red; with `trim()` back and the
  guard on, nothing does. The swap stays as defence in depth, and only shows
  with the guard off (A with U+00A0).
- **The guard reads the CRLF-normalised texts**, so a `\r` left from a CRLF
  blank line is not taken for Unicode white space.
- **The walk in `hunks` needed no change of its own.** A weight depends only
  on the line's text, so taking a match whenever two lines agree stays
  optimal; the walk only had to read the weighted table.

**Discovered**
- Case A with U+3000 was already refused at the round-0 head, through the
  unwritable-save path. Its new test was green before the fix as well as
  after, and is reported that way.
- Case B is now refused with the generic notice "would not write it back
  exactly". `firstDifference` works from the lexer's blocks, which agree with
  the editor's output except for blank lines. The notice is not wrong, but it
  is not specific. It is a candidate for LAI-854's scope (a notice that names
  nothing). I did not file it separately, because this round is limited to
  `server/web/`, the task file and this log.
- **Known limit, left alone as asked:** past a million cells, `hunks` reports
  the whole middle as one hunk. On a very long description the notice then
  names the first line of that span, not necessarily the line that changes.
- **My first mutation harness this round ran 3 tests where 7 were meant.** An
  escaped `U\+00A0` in the name pattern matched nothing, so its "green" meant
  "did not run". Printing `# tests` per run caught it, and the harness now
  fails loudly unless 7 ran.
- `splitUnits` (LAI-827, unchanged from master) still tests for blank with
  `trim()`. It plans a save; it does not decide whether a document opens. A
  document with such a line reaches it only after the same strict check
  master runs.

**State**
The fix is committed. The gate and the push to PR #4 follow, after the load
drops below 20; their exit codes are in the round's report.
