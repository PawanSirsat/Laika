---
id: LAI-868
title: '`@name` mentions show as pills in descriptions, comments and the rich editor; the viewer''s stronger, @strelka and @belka softer'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

When a task's description, acceptance criteria or comments mention someone
with `@name`, the mention shows as a **pill**. It also shows as a pill while
it is typed in the rich editor.

- When the mention is **the viewer**, the pill is stronger.
- The two machine handles **`@strelka`** and **`@belka`** (D-097) are not
  users, and get a softer pill.

This is a screen-only change. **The stored text does not change by one byte**,
and the editor's round-trip guard (LAI-827, LAI-849) is unaffected.

## What is there today (read at `28cf1877`)

- **The server reads mentions in comments only.**
  - `parseMentionHandles` (`server/src/services/mentions.ts:66-73`) uses
    `/(?<![A-Za-z0-9_@.+%-])@([A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?)/g`.
    So `ada@example.com` is not a mention, while `(@ada)` and `**@grace**`
    are.
  - A handle is the email's local part, case-insensitive. **An ambiguous
    one resolves to nobody, and "It renders as plain text"** (SPEC §4.19,
    `docs/SPEC.md:1014-1022`).
  - It is called for comments only (`server/src/services/comments.ts:244`,
    `:289`). Descriptions are not parsed.
  - The resolved rows are never sent to the client.
- **The `@` people list exists.** It shows in the description, acceptance
  and comment editors:
  - `findMention` is at `server/web/src/routes/screens/task/editor/RichEditor.tsx:124-140`.
    Its own pattern (`:136`) differs from the server's.
  - The list opens at `:438-454` and renders at `:902-929`.
  - Choosing a person inserts **plain text**, `@handle ` (or `@Full Name `
    when there is no handle; `:394-405`).
  - The people come from `GET /projects/:slug/mentionable`, with each handle
    computed as a member's email local part (`TaskDetailPanel.tsx:193-220`,
    `handleOf` `:132-136`). The panel also has `meId` (`:80`).
- **Nothing is highlighted anywhere.**
  - The read-only renderer is `TaskMarkdown`
    (`server/web/src/routes/screens/task/TaskMarkdown.tsx`), with
    react-markdown and remark-gfm.
  - It is used for the description and acceptance (`DocumentField.tsx:70`,
    `:101`), comments (`CommentBody.tsx:47`) and a send-back reason
    (`EvidenceSection.tsx:256`).
  - It has no `@` handling. Its plugins are module constants, and "a caller
    cannot pass a tree transform" (`:29-33`).
  - `task-markdown-props.test.ts:51-54` asserts those exact plugin
    expressions.
  - The only mention CSS in web is the picker's (`.rte-mentions`,
    `rich-editor.css:400`).
- **The round-trip guard.**
  - `openDocument` (`editor/markdown-bridge.ts:1173-1203`) opens rich only if
    parse-then-write gives the same Markdown.
  - The bridge's schema comes from `MARKDOWN_EXTENSIONS`
    (`editor/extensions.ts:232`). The editor adds `Placeholder` beside it
    (`RichEditor.tsx:261`).
  - A new mark or node in `MARKDOWN_EXTENSIONS` changes what the bridge
    compares. A ProseMirror **decoration** does not.
  - Helper `roundTrips` is at `markdown-bridge.test.ts:32-36`. Browser guard:
    `task-panel-editing.test.ts:753` (*nothing an agent wrote is silently
    rewritten*).
- **Tokens.**
  - Colours live only in `server/web/src/styles/theme.css` (D-020).
    `server/web/test/tokens.test.ts` guards that.
  - **Trap:** in dark, `--accent`, `--accent-bg` and `--accent-border`
    (`:66-68`) equal `--chip-purple`, `--chip-purple-bg` and
    `--chip-purple-border` (`:94-96`). A viewer pill on one family and a
    person pill on the other would look the same in dark.
  - Other candidates: `--on-accent` (`:70`, `:163`), `--chip-neutral*`
    (`:98-100`, `:184-186`), `--radius-pill`, `--radius-chip` and
    `--chip-padding` (`:257-265`).

## Acceptance criteria

- [ ] **One grammar.** The web finds mentions with the server's pattern. A
      web test reads `server/src/services/mentions.ts` as text and asserts the
      web pattern's source equals `parseMentionHandles`'s, so the two cannot
      drift. A pill covers exactly the characters that pattern matches.
- [ ] **Who gets a pill.** A handle gets a pill when it matches exactly one
      person in the panel's people list (`/mentionable`, handles as
      `TaskDetailPanel.tsx:212-219` builds them). If two people share the
      handle, or nobody has it, it **stays plain text**, as SPEC §4.19 says.
      `strelka` and `belka`, when no person holds them, get the machine pill.
      Matching is case-insensitive.
- [ ] **Three looks, existing tokens only.**
      - **Viewer:** the matched person's id is `meId`. This is the stronger
        style.
      - **Person:** anyone else.
      - **Machine:** `@strelka`, `@belka`. This is the softer style.

      No new colour or token, and `tokens.test.ts` passes unedited. A browser
      test, in **light and dark** (`setTheme`, `server/web/test/browser/harness.ts:556`),
      reads each kind's computed `background-color` and `color`. It asserts
      the three kinds differ pairwise in both themes. It fails today, because
      there is no pill.
- [ ] **Read-only surfaces.** Pills show in the description, the acceptance
      criteria and comments, through `TaskMarkdown`, so `EvidenceSection`
      gets them too. There are no pills inside inline code, code blocks or
      link text.
      - The people list and `meId` reach `TaskMarkdown` as data. The mention
        transform is owned inside `TaskMarkdown` and stays a module constant.
      - `task-markdown-props.test.ts:51-54` is changed only as far as that
        requires, and the change is named in the task file.
      - Browser tests (`task-markdown.test.ts`, `comment-markdown.test.ts`)
        assert:
        - a pill on `@ada`, `(@ada)` and `**@grace**`;
        - none on `ada@example.com`, `` `@ada` `` or an ambiguous handle;
        - the viewer's own handle gets the viewer style.
- [ ] **A pill adds no text.** The element's text is exactly the source's
      characters, so copying, find and screen readers read what was written.
      `comment-markdown.test.ts:196-204`, which asserts `@Ada Lovelace` in the
      first paragraph's text, passes unedited.
- [ ] **The rich editor.** Pills show while editing the description,
      acceptance and a comment. They come from a ProseMirror **decoration**
      plugin, added beside `Placeholder` (`RichEditor.tsx:261`), never as a
      mark or node in `MARKDOWN_EXTENSIONS`, which this task does not change.
      A pill appears when a person is chosen from the `@` list. The browser
      test (`task-panel-editing.test.ts`, near `:719`) asserts it.
- [ ] **Byte-identical round trip.** A new case in `markdown-bridge.test.ts`
      uses `roundTrips` on a description holding:
      - `@ada`, `(@ada)`, `**@grace**`;
      - `@strelka` and `@belka`;
      - `ada@example.com`, `` `@ada` ``;
      - `@Ada Lovelace`;
      - a mention ending a line with a trailing space.

      It asserts the output **equals the input byte for byte**. The browser
      guard at `task-panel-editing.test.ts:753` gains the same description:
      opened in the editor and left untouched, it sends no `PATCH`. These are
      guards that pass before and after.

      **Mutation:** register the pill as a mark in `MARKDOWN_EXTENSIONS`
      instead of a decoration. The round-trip case goes red. Prove the
      mutation landed with a `grep`, restore the file, and record the run in
      the task file.
- [ ] **Stored text unchanged.** The composer still posts
      `{ body_md: '**Done** for @ada' }` (`task-panel-editing.test.ts:1202`),
      unedited.
- [ ] **SPEC, a named edit (D-033/D-034):** one sentence in §11.4.2.1's task
      panel entry, next to the `@` autocomplete (`docs/SPEC.md:4118-4121`),
      saying a mention that names someone shows as a pill. §4.19's "It
      renders as plain text" stays as written.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Belka** (D-097; board tag `host-belka`). It goes first, before
  LAI-865 (owner's order, 2026-10-22).
- **Area:** `server/web` only. Files:
  - `server/web/src/routes/screens/task/TaskMarkdown.tsx` and its CSS;
  - a new mention helper beside it (for example
    `server/web/src/routes/screens/task/mentions.ts`);
  - `editor/RichEditor.tsx` and `editor/rich-editor.css`;
  - `DocumentField.tsx`, `CommentBody.tsx`, `EvidenceSection.tsx`;
  - `server/web/src/routes/screens/board/TaskDetailPanel.tsx`, to pass the
    people list and `meId` down;
  - the tests named above.

  The SPEC sentence above is the only file outside the area. No server
  change and no new dependency.
- **Known limit, until LAI-839** (backlog: `/mentionable` returns the handle
  the server resolves, `null` when ambiguous):
  - the client sees only the people it is offered;
  - a handle shared with someone outside that list, such as another domain
    or a deactivated account, resolves to nobody on the server, yet shows as
    a pill here;
  - once LAI-839 lands, use its `handle` instead of `handleOf`.

  This is not a dependency.
- The server also reads `@` inside code spans (`mentions.ts:46-56`, a known
  limitation). Showing code literally is right for the screen. Whether the
  server should stop is not this task.
- A mention by name, `@Ada Lovelace`, is read by the server as `@Ada`, so
  only `@Ada` can become a pill. That is the grammar, said honestly.
