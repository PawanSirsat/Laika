---
id: LAI-871
title: 'Mention pills: `_@ada_` and `__@ada__` show a pill the server does not resolve'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-868
status: backlog
---

## Goal

A pill means somebody was notified. Today `_@ada_` and `__@ada__` show a pill
in the reading view and in the rich editor, and the server notifies nobody.
That is the harm SPEC §4.19 warns about: the writer believes they notified
somebody, and nobody was told. Make the pill and the server agree.

## What is there today (read at `16c19db8`)

- `server/src/services/mentions.ts:67`, `parseMentionHandles`, runs its
  pattern over the **Markdown source**. Its lookbehind refuses `_` before the
  `@`, so `_@ada_` and `__@ada__` both return `[]`. `*@ada*` returns
  `["ada"]`.
- `server/web/src/routes/screens/task/TaskMarkdown.tsx:152` runs
  `findMentions` over each **rendered text node** on its own. Emphasis has
  already taken the `_` markers off, so the node is `@ada` and it gets a pill.
- `server/web/src/routes/screens/task/editor/mention-pills.ts:38` does the
  same over each ProseMirror text node, where the `_` is an italic or bold
  mark rather than a character. It also gets a pill.

The web pattern is the server's character for character (`mentions.test.ts`
keeps it so). The two disagree because they read different text, not because
the patterns drift.

Measured with the server's pattern in `node` on 2026-10-22:

| source | server handles |
| --- | --- |
| `_@ada_` | `[]` |
| `__@ada__` | `[]` |
| `*@ada*` | `["ada"]` |
| `@ada` | `["ada"]` |

## Acceptance criteria

All of these fail today.

- [ ] `_@ada_` and `__@ada__` render **no pill** in the reading view
      (`TaskMarkdown`: descriptions, acceptance criteria and comments).
- [ ] `_@ada_` and `__@ada__` render **no pill** in the rich editor.
- [ ] The web and the server agree on **one shared table of cases** (source
      text → handles, including the four rows above), and a test on each side
      reads that table, so a case added to it is checked on both.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- **A possible fix for the reading view.** The rehype step receives the source
  file, so it can look up the character before the `@` in the original text
  through the text node's position, and skip the match when the server's
  lookbehind would refuse it.
- **The editor needs its own answer.** A ProseMirror document has no Markdown
  source. The `_` is a mark, so the check probably has to ask whether the text
  node is under an emphasis mark that serialises as `_`, or serialise the
  surrounding text. Decide and record which.
- **Ownership.** The shared table sits between `server/` and `server/web/`.
  If its server-side test is a change to `server/test/`, that half is a
  §4.4 crossing and must be named, not taken.
