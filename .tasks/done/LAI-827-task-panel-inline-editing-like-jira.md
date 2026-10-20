---
id: LAI-827
title: 'Task panel edits in place like Jira: hover shows what is editable, click to edit, and the description gets a real editor with a toolbar'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-795
status: done
started: 2026-10-20T19:12:35Z
finished: 2026-10-20T21:16:51Z
---

## Goal

The task panel reads and edits like Jira's issue view. Owner, 2026-10-21, with
three screenshots of Jira KAN-10 and one of Laika ONR-516:

> *"see how good it looks in JIRA when we hover on the title or on the
> description, and it's fully editable, all tools are there as well, so let's
> implement this in our task detail popup as well, because see how dirty it
> looks in Laika"*

What the screenshots show:
- **Jira:** hovering the title or the description shows a soft grey
  background, nothing else. Clicking turns it into an editor in place: the
  title into an input, the description into a rich editor with a toolbar
  (text style, bold, lists, code, link, mention, undo/redo) and Save / Cancel
  under it. Reading and editing look like the same document.
- **Laika (ONR-516):** the description is a cramped box with small text, and
  an "Edit description" button floats over the first lines of text.

Made on the owner's direct instruction (CLAUDE.md §4.2 "if you are one agent
doing all of it").

## Acceptance criteria

- [x] **Hover affordance.** Title, description, acceptance criteria and the
      editable fields in Details (assignee, priority, labels, dates, sprint,
      effort) show a soft background on hover and a text cursor / pointer,
      in light and dark, only for people who may edit the task. Readers who
      cannot edit see no hover and no editor.
- [x] **Title in place.** Click the title: it becomes an input with the same
      font and size. Enter or blur saves; Esc cancels; empty is refused.
- [x] **Description and acceptance in place.** Click (anywhere not on a
      link): a rich editor opens in place with a toolbar and Save / Cancel.
      ⌘/Ctrl+Enter saves, Esc cancels (asks first if there are unsaved
      changes). The floating "Edit description" button is gone.
- [x] **Toolbar:** paragraph / H1–H3, bold, italic, strikethrough, inline
      code, bullet list, numbered list, checklist, quote, code block, link,
      table (insert and edit rows/columns), @mention a member, link a card by
      key, undo, redo, and a **Markdown** toggle that shows the source. No
      image upload and no text colour: Laika has no uploads and markdown
      cannot store colour.
- [x] **Markdown stays the stored format, and nothing is silently
      rewritten.** `description_md` and `acceptance_md` stay markdown. When a
      document opens, the editor checks that parsing and re-serialising it
      gives the same markdown (after a stated normalisation). If it does not
      (an agent wrote something the editor cannot represent), that document
      opens in Markdown source mode and says why, so saving never changes
      text the person did not touch. A Save with no change sends nothing.
- [x] **Safety unchanged.** What is shown after saving renders through the
      same safe renderer as today: raw HTML stays text, `javascript:` links
      are disabled, images never load. The editor itself never executes or
      loads pasted HTML; pasting from Jira, Docs or a web page keeps text,
      lists, links and tables, nothing else.
- [x] **Stale-text protection from LAI-795 holds.** The editor stays locked
      while the full text loads or is stale, and a save made against an older
      version is refused with a clear message, not written over newer text.
- [x] **Comment composer** uses the same editor (toolbar, mentions, card
      links, Markdown toggle).
- [x] **Reading view** of description, acceptance and comments uses the
      larger reading size defined in LAI-828 if it has landed, otherwise
      15px with line-height 1.6, through the type tokens, not hard-coded
      sizes.
- [x] **Bundle.** The editor is lazy-loaded the first time someone edits, so
      the Board and List do not download it. Report the main bundle and the
      editor chunk sizes before and after (gzip).
- [x] **Tests.** Browser tests for: hover only for editors; title edit and
      Esc; description edit, toolbar actions, Save and Cancel; the round-trip
      guard opening an agent-written document in source mode; a stale save
      refused; no request on an unchanged Save; paste stripping HTML. Each
      fails on today's code.
- [x] **Screenshots** before and after, light and dark, 1440 and 390, of a
      long agent-written description like ONR-516, reading and editing.
- [x] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- **New dependencies allowed by this task, and only these:** `@tiptap/react`,
  `@tiptap/pm`, `@tiptap/starter-kit`, the TipTap extensions needed for link,
  task list / task item, table, placeholder and mention (all `@tiptap/*`),
  and one markdown bridge: the official `@tiptap/markdown` if it exists at a
  version matching the other `@tiptap/*` packages, otherwise `tiptap-markdown`.
  Check each is MIT-licensed and record versions and licences in the task
  file. Pin exact versions in `server/web/package.json`; update the lockfile.
- Self-host everything: no CDN, no remote fonts, no telemetry.
- Mention and card-link suggestions use endpoints that already exist
  (members, tasks search); do not add server endpoints in this task. If one
  is genuinely missing, file it and ship without that suggestion.

## Delivered (LAI-827, owner-direct)

Branch `LAI-827-task-panel-editing`, merged with `master` at b5c28998 before the
gate. Not pushed, no PR (the orchestrator's instruction).

### What it is

- **Description and acceptance** (`DocumentField.tsx`) read through the same
  `TaskMarkdown` as before, now at the reading size, with a soft background on
  hover for an editor only. A click anywhere not on a link opens the editor in
  place, caret where the click was. The floating *Edit description* button is
  gone; a visually hidden button keeps the keyboard's way in.
- **The editor** (`editor/RichEditor.tsx`, TipTap 3) — toolbar: text style
  (Normal / H1–H3), bold, italic, strikethrough, inline code, bulleted,
  numbered and checklist, quote, code block, link, table (insert; rows and
  columns above/below/before/after; delete row, column, table), @mention, link
  a card, undo, redo, Markdown. Save / Cancel under it; ⌘/Ctrl+Enter saves;
  Escape asks *Discard your changes?* when something changed (Cancel discards
  at once). An Escape the editor spends no longer closes the drawer
  (`TaskDrawer.tsx` honours `defaultPrevented`).
- **Markdown stays the format** (`editor/markdown-bridge.ts`). A document opens
  rich only when parsing and writing it back gives the same markdown after the
  **stated normalisation — layout only**: line endings; trailing spaces and
  tabs; runs of blank lines and blank lines at either end; in table rows, cell
  padding and the dash count of delimiter cells (alignment colons kept).
  Anything else (`* bullets`, `_italic_`, a loose list, raw HTML, an image)
  opens in Markdown source with the reason, e.g. *It contains HTML (<details>),
  which the rich editor would not keep as written* or *The rich editor would
  rewrite line 3: “* a” as “- a”*. An unchanged Save sends nothing.
- **Faithful escaping.** `@tiptap/markdown` 3.32.0 escapes every `*`, `_`, `~`,
  `[`, `` ` ``, `\` and writes `<`, `>`, `&` as entities (`next_cursor` →
  `next\_cursor`, `p95 < 1 s` → `p95 &lt; 1 s`, `A -> B` → `A -&gt; B`) — it
  would have sent almost every agent document to source mode. The bridge
  replaces the text encoder (a private hook; a test fails if it disappears)
  with one that escapes only what could read as markdown, and uses that output
  only when it parses back to the identical document; otherwise the library's
  own. Bare URLs, `www.` and email links stay bare. It also escapes line-start
  block markers (`# x`, `- x`, `1. x`, `> x`, `---`), which the library's own
  escaper misses — typed as text they came back as a heading or a list.
- **Safety unchanged.** What is shown after a save is `TaskMarkdown`, as before.
  The editor has no image node; `injectCSS: false` (no `<style>` under
  `style-src-elem 'self'`, the ProseMirror rules are in `rich-editor.css`).
  Paste (`editor/paste.ts`) is reduced in an inert `DOMParser` document to
  text, lists, links (absolute http(s)/mailto only) and tables; scripts,
  styles, images, iframes and the like are dropped whole; a dropped file is
  refused.
- **Stale-text protection (LAI-795) holds**: not editable while the full text
  loads or is stale; a save against an older version is refused with *This
  description changed while you were editing…*, the draft kept. Acceptance
  edits carry the same check, per field.
- **Title** (`InlineEdit.tsx`): opens in the heading's own font, size and
  weight, as a one-line textarea that grows so a long title wraps as the
  heading does (an `<input>` would scroll it sideways). Enter or blur saves,
  Escape cancels, empty is refused without a request (*A task needs a title.*).
- **Details hover**: assignee, priority, due, labels, sprint, start (and
  parent, effort's *Change*) mark `data-editable` only when that reader may
  change them; the highlight is a spread shadow, so no row moves.
- **Comment composer** (`CommentComposer.tsx`): one quiet *Add a comment…* line,
  the same editor once clicked (toolbar, @, card links, Markdown). A failed post
  keeps the draft and says why (`use-task-detail.ts` `post` now rejects).
- **@ and card links** use existing endpoints: who = `GET
  /projects/:slug/mentionable`; the handle written is the email local part from
  `GET /projects/:slug/members`, which is what the server resolves; a
  mentionable person with no member row is written by name (LAI-839 filed).
  Cards come from the board's own list; a card link is
  `[KEY](/board?project=…&task=…)`.
- **Reading size**: LAI-828 has not landed, so 15px on 1.6 through new tokens
  `--text-reading`, `--leading-reading` and heading steps `--text-reading-h1/2/3`
  (20/18/16px) and `--text-reading-code`, in `styles/theme.css` and
  `token-list.ts`. `type-floor.test.ts` now reads token names with digits and
  hyphens, so it still covers them.

### Dependencies (server/web/package.json, pinned exactly)

| package | version | licence | why |
|---|---|---|---|
| `@tiptap/react` | 3.32.0 | MIT | named |
| `@tiptap/pm` | 3.32.0 | MIT | named |
| `@tiptap/starter-kit` | 3.32.0 | MIT | named |
| `@tiptap/core` | 3.32.0 | MIT | required peer of every `@tiptap/*` package |
| `@tiptap/extension-link` | 3.32.0 | MIT | link (StarterKit bundles it but does not export it to extend) |
| `@tiptap/extension-list` | 3.32.0 | MIT | task list / task item (their v3 home) |
| `@tiptap/extension-table` | 3.32.0 | MIT | table |
| `@tiptap/extensions` | 3.32.0 | MIT | placeholder (v3 home of `extension-placeholder`) |
| `@tiptap/markdown` | 3.32.0 | MIT | the official bridge, at the matching version, so `tiptap-markdown` is not used |

No mention extension: `@` is the editor's own picker writing plain `@handle`,
which is what the server parses; a mention node would need markdown of its
own. The lockfile gained 54 packages in all, **every one MIT** — the `@tiptap/*`
set StarterKit pulls in, `prosemirror-*` 13, `marked` 17.0.6, `linkifyjs` 4.3.3,
`@floating-ui/*` (via `@tiptap/react`'s optional menus, not imported),
`fast-equals`, `use-sync-external-store`, `orderedmap`, `rope-sequence`,
`w3c-keyname`. Nothing is fetched at run time: no CDN, fonts or telemetry.

### Bundle (gzip -9, bytes)

| | master b5c28998 | this branch (merged) |
|---|---|---|
| main JS | 335,982 | 337,018 (+1,036) |
| main CSS | 54,302 | 54,311 (+9) |
| editor chunk JS (`RichEditor-*.js`, lazy) | — | 163,590 (527,773 raw) |
| editor chunk CSS | — | 1,958 |

ProseMirror is only in the editor chunk; the browser test asserts the Board
requests no `RichEditor` script until the first edit, and then exactly one.
(Against the branch point f0b87ebe before master's LAI-830 landed: main JS
332,422 → 333,448.)

### Tests

- `test/browser/task-panel-editing.test.ts` — 18 test cases (18 `test()`
  calls), **all 18 fail on f0b87ebe's `server/web/src`** and pass here.
- `test/routes/screens/task/editor/markdown-bridge.test.ts` — 48 cases from 12
  `test()` calls; `extensions.test.ts` 4; `paste.test.ts` 5.
- Updated to the new surfaces, same assertions: `slim-list.test.ts`,
  `task-markdown.test.ts`.
- Mutations, each restored and the tree checked clean: unchanged-Save always
  sending, the round-trip guard off, paste reduction off, the stale check off,
  the editor imported eagerly, a reader marked editable, an empty title allowed,
  the caret opening at the end — each turns its test red. Bypassing the escape
  hook turns 13 bridge cases red.
- **What turned out not to matter, and is gone**: a *121px jump* on opening
  was Playwright's `locator.click()` scrolling the panel itself (measured: it
  does so for a reader for whom no editor opens; a mouse click at the same
  point moves nothing). A held minimum height and a scroll-anchoring rule built
  against it were removed (commit 47d9087b corrects cd34c8b9 and f4a01536).
  The panel test now clicks by coordinates.
- Two traps for whoever writes the next editor test: on macOS `End` scrolls the
  page instead of moving the caret, and ProseMirror reads a click's caret from
  a `selectionchange` a moment later than Playwright's next key — click after
  the last word and pause (`caretAtEnd`).

### Screenshots

`/tmp/laika-editor-shots/` — `before-*` and `after-*`, reading / hover /
editing (and `editing-foot`), light and dark, 1440 and 390, of an ONR-516-like
agent description; plus `after-mention-*`, `after-table-tools-*`,
`after-composer-*`, `after-source-mode-*` at 1440.

### Filed

- LAI-839 — `mentionable` should answer the handle `@` resolves (area server).
- LAI-840 — no way to add acceptance where a task has none (area web; SPEC
  line for CHIEF).

## Review round 1 — fixed (owner-direct)

The review came back **BLOCK** on one data-safety bug, with four smaller
items. Criteria unchanged; this is what was done about each.

1. **Blocking: a save rewrote blocks nobody touched.** When the faithful form
   could not write one new paragraph, `toMarkdown` sent the *whole* document
   through the library's escaping, unchecked — `next_cursor`, `p95 < 1 s` and
   `A -> B` were rewritten and `\# literal hash` became a heading. Now
   (`markdown-bridge.ts`, d1346ceb):
   - the opening remembers the source's top-level blocks; on a save every
     block still as it was is **copied from the source byte for byte**, and
     only new or changed blocks are written — each faithfully, else in the
     library's form, **each checked by reading it back**, and the whole result
     checked again;
   - when a block cannot be written so, nothing is saved: `UnwritableMarkdown`
     carries the reason and a draft (untouched blocks as they were), and the
     editor opens the draft as Markdown with *Not saved: …* (5a6d4c73);
   - the faithful escaper now escapes a `<` that starts a tag, comment or
     autolink, an `&` that forms an entity, a line that would be a link
     reference definition, plain-text `https://` / `www.` / email addresses,
     and a delimiter beside another mark's syntax;
   - what markdown cannot hold — spaces at a text block's ends, a last line
     break — no longer counts as a change (found on the way: a mention ends
     with a space, so every save after one was refused).
2. **Fences.** A ```` ```js ```` line inside a ```` ``` ```` block is code, not
   its close; neither `tidy` nor the normalisation touches lines inside code.
3. **Flaky test.** The scroll test clicked between two lines and accepted two
   text nodes; it now clicks the first line and waits for the caret block it
   asserts. Running the file ten times turned up a second flake (the `@` test,
   1 in 10): `openEditor` clicked the top-left to open and the tests clicked the
   end to type, and Playwright typed before ProseMirror read the second click.
   `openEditor` now clicks after the last word, scrolled into view, and waits
   for the editor's focus (8b82aa64). **Ten runs in a row: 22/22 each.**
4. **Escape on a toolbar, Save or Cancel button** reached the drawer and threw
   the draft away; any Escape inside the editor is now the editor's and asks
   when something changed.
5. **A mention** is inserted as a text node, so a name with `<b>` in it stays
   words.

**Red first.** Unit: the reviewer's inputs (`the <br> tag`, `an <input>
field`, `use <details> here`, a comment, `use &amp; here`, `[a]: https://x`, a
`*` beside a bold word), a compact table kept compact, an unwritable block
refused, and the two fence cases — **11 of the first 12 new cases failed
against the round-0 bridge** (run from a scratch copy with a stand-in for the
new error class); block removal passed there and stays as a guard. The three
cases added later (a trailing space, a paragraph of spaces, two lists that
merge) are held by mutation. Browser, against the round-0 `RichEditor.tsx` and
bridge: **all four new tests failed** — the `<br>` save rewrote the first
paragraph to `Set next\_cursor; see [https://example.com/a\_b](…)`, the
unwritable change was sent, Escape on Bold closed the panel, and the name came
out bold.

**Mutations, each restored**: untouched blocks not copied, `<` not escaped, `&`
not escaped, the per-block check off, the whole-document check off, a fence
closing on an info string, text-block ends not canonical, Escape on buttons
unhandled, a mention inserted as an HTML string, a refused save sent anyway —
**all ten turn a test red** (the whole-document check only once the
two-merging-lists case was added).

**Ran:** `node --test test/routes/screens/task/editor/*.test.ts` (72 cases,
exit 0); `node --test test/browser/task-panel-editing.test.ts` ×10 (22 cases,
exit 0 each); the related panel files `slim-list`, `task-markdown`,
`task-panel`, `comment-markdown` (35 cases, exit 0); `pnpm lint` and
`pnpm format` from the root, each its own exit code — in the round-1 report.
The full root gate is CHIEF's after merging.

## Accepted (CHIEF, 2026-10-21)

Review (review-task-panel-editing): BLOCK on one data-safety bug. One edit
could make the save fall back to TipTap's escaping for the whole document,
rewriting untouched text (`next_cursor` became `next\_cursor`, `A -> B`
became `A -&gt; B`, and `\# hash` became a heading). Fixed in `d1346ceb`:
untouched blocks are copied byte for byte from the source; changed blocks
are written, read back and checked; anything that will not read back
refuses to save and opens the draft as Markdown. Also fixed: fences inside
code, Escape anywhere in the editor asks first, mentions are inserted as
text, and two flaky tests. CHIEF read the byte-identical test suite and ran
the editor unit files (72/72, exit 0). Security, dependencies (nine
`@tiptap/*` packages at 3.32.0, 54 MIT packages, no network access) and lazy
loading were verified by the reviewer. Follow-ups: LAI-839 (mention handles
for org Owners and Admins) and LAI-840 (adding acceptance where none exists;
needs a SPEC decision).

