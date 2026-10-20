## 2026-10-20T21:20:00Z — LAI-827

**What changed**
- server/web/package.json, pnpm-lock.yaml — TipTap 3.32.0 (`@tiptap/core`, `pm`, `react`, `starter-kit`, `extension-link`, `extension-list`, `extension-table`, `extensions`, `markdown`), pinned exactly, all MIT; 54 lockfile packages in all, all MIT
- server/web/src/routes/screens/task/editor/markdown-bridge.ts — open-rich-only-if-it-round-trips guard, the stated layout-only normalisation, faithful escaping verified by re-parse, line-start block markers escaped
- server/web/src/routes/screens/task/editor/extensions.ts — the schema markdown can hold (no underline, image, trailing node); bare-URL links written bare
- server/web/src/routes/screens/task/editor/paste.ts — paste reduced in an inert document to text, lists, links, tables
- server/web/src/routes/screens/task/editor/RichEditor.tsx, rich-editor.css — the editor: toolbar, Markdown toggle, @ picker, card picker, link popover, table tools, Save/Cancel, Escape confirm; ProseMirror base CSS since `injectCSS: false`
- server/web/src/routes/screens/task/LazyRichEditor.tsx — props and the `import()` boundary, load-failure state
- server/web/src/routes/screens/task/DocumentField.tsx — description/acceptance read and edit in place; the floating Edit button is gone
- server/web/src/routes/screens/task/InlineEdit.tsx — title in the heading's own type, empty refused, `data-editable`
- server/web/src/routes/screens/task/CommentComposer.tsx — one quiet line, then the same editor
- server/web/src/routes/screens/board/TaskDetailPanel.tsx — wiring, per-field stale check, mention/card candidates
- server/web/src/routes/screens/task/TaskMeta.tsx, ForecastSection.tsx — `data-editable` on editable Details values and the effort control
- server/web/src/components/drawer/TaskDrawer.tsx — an Escape already spent (`defaultPrevented`) no longer closes the drawer
- server/web/src/api/use-task-detail.ts — `post` rejects on failure so the composer keeps the draft
- server/web/src/routes/screens/task/task-panel.css, task-markdown.css, CommentBody.tsx — hover affordance, reading size, dead textarea-composer rules removed
- server/web/src/styles/theme.css, src/theme/token-list.ts, test/theme/type-floor.test.ts — reading tokens; the floor reads token names with digits/hyphens
- server/web/test/browser/task-panel-editing.test.ts (18 cases), test/routes/screens/task/editor/{markdown-bridge,extensions,paste}.test.ts (48, 4, 5 cases)
- server/web/test/browser/slim-list.test.ts, task-markdown.test.ts — same assertions on the new surfaces
- .tasks/backlog/LAI-839-…, LAI-840-… — filed; .tasks/review/LAI-827-… — delivery record

**Decisions**
- Replaced `@tiptap/markdown`'s private text encoder rather than accept its escaping — measured, it turned `next_cursor`, `p95 < 1 s` and `A -> B` into escapes and entities, which would have opened nearly every agent document as source and filled people's text with backslashes agents then read. The faithful form is used only when it parses back to the identical document, so the worst case is the library's own output.
- Normalisation is layout only (line endings, trailing spaces, blank-line runs, table padding) — not `*`/`-` or `_`/`*`, which would let a save rewrite characters nobody touched.
- No mention extension: `@` writes plain `@handle` text, which is what the server parses; the handle comes from members' emails because `mentionable` answers none (LAI-839).
- The title field is a one-line growing textarea, not an `<input>`: a long title then wraps as the heading does instead of scrolling sideways.
- Comment composer collapsed to a line at rest, so opening a task does not download the editor.

**Discovered**
- `mentionable` gives no handle; owners/admins with no member row cannot be @-mentioned correctly from any picker → LAI-839 filed (discovered-from: LAI-827).
- SPEC draws Acceptance only when set, so the panel cannot add one → LAI-840 filed (discovered-from: LAI-827).
- A "121px jump" on opening, chased through three fixes, was Playwright's `locator.click()` scrolling the panel itself — it does it for a reader with no editor; a mouse click moves nothing. The fixes it justified (held height, anchoring rule) were removed and the commit says so. Use `page.mouse.click` when measuring scroll.
- On macOS `End` scrolls the page and leaves the caret; ProseMirror reads a click's caret from `selectionchange` a beat after Playwright's next key. `caretAtEnd` in the test handles both.
- `useEditor` re-applies state on every render when its options are rebuilt per render; options are memoised once.
- TipTap's `onMount` fires during the first render (view detached); caret placement waits a frame.
- The library's escaper misses line-start block markers (`# x` typed as text came back a heading); the faithful escaper handles them.

**State**
In .tasks/review/. Merged master b5c28998; not pushed; no PR (orchestrator's instruction).
