---
id: LAI-1301
title: 'Attachments (web): attach, paste and drop files in the editor, images inline, an Attachments section on the task (D-150)'
area: web
assignee: chief
priority: p1
depends-on: [LAI-1300]
status: review
finished: 2026-11-17T10:24:38Z
started: 2026-11-17T09:38:34Z
---

## Goal

The web half of D-150, against LAI-1300's contract. Wherever the shared rich editor is used —
task description and acceptance, the comment composer and comment edit, the create-task
dialog — a person can attach files with a paperclip button, by pasting (a screenshot from the
clipboard) or by dropping files, see upload progress, and get an inline image or a file link
in the text. Images from attachments render inline in every markdown view; other attachments
render as file chips. The task panel gains an **Attachments** section listing every file on
the task with download and delete. When `OrgView.attachments` is `null` (the AWS board),
none of this appears and the editor behaves exactly as today.

## Acceptance criteria

- [x] `api/attachments.ts`: ask (`POST /projects/:slug/attachments`), upload with an
      `XMLHttpRequest` `PUT` to the presigned URL with progress and the two signed headers
      exactly as returned (the raw-fetch exception, like the CSV download in `api/time.ts`),
      then `complete`; list, delete. Too large is refused before asking, using
      `OrgView.attachments.max_bytes`.
- [x] Editor (`task/editor/RichEditor.tsx`, `LazyRichEditor.tsx`): an `attach?` prop; a
      paperclip toolbar button with a hidden file input (multiple); `handlePaste` takes
      clipboard files; `handleDrop` uploads dropped files where today it swallows them; a
      placeholder while uploading, replaced by `![name](/api/v1/attachments/<id>/content)`
      for an inline image or `[name](…)` otherwise; failures say why (too big, off, network)
      and leave the text intact. In Markdown source mode the snippet is inserted at the caret.
- [x] `@tiptap/extension-image@3.32.0` (the one new dependency, pinned exactly, matching
      `@tiptap/core 3.32.0`) configured `inline: true`, accepting **only** attachment URLs;
      `markdown-bridge.ts` round-trips attachment images and still opens any other image in
      source mode (wording: "an image from outside Laika"). `paste.ts` still strips HTML
      `<img>`.
- [x] `task/TaskMarkdown.tsx`: `<img loading="lazy">` only for same-origin
      `/api/v1/attachments/<ULID>/content` sources (click opens the file in a new tab); any
      other image stays alt text; an attachment link renders as a file chip with a file glyph.
- [x] New `task/AttachmentsSection.tsx` (+ `attachments-derive.ts`, `attachments.css`) in
      `board/TaskDetailPanel.tsx` **after `EvidenceSection` and before `ActivityFeed`**: each
      ready file with type glyph, name, size, uploader, when, open/download, delete (shown
      only where `attachment.delete` would allow); an "Attach files" button and a drop zone;
      refreshes on `attachment.*` stream frames; hidden when the feature is off.
- [x] Glyphs are inline 24-grid SVG paths like the rest (no icon package): paperclip, file,
      image, sheet, pdf.
- [x] Both themes, phone width, keyboard reachable, `aria` labels; tokens only, no new
      colours.
- [x] Tests: `attach.ts`/derive unit tests; `markdown-bridge`, `extensions`, `paste`,
      `task-markdown-props` updated; browser tests for button upload (store stubbed), paste,
      drop, inline render, chip render, delete and the off state; `structure.test.ts` `WEB_*`
      maps; `view-type-drift` pairs.
- [x] CI gate green on the PR: test, lint and format each exit 0.

## Notes / context

- Belka rule: single test files only; CI runs the gate.
- The store host is cross-origin: the server's CSP lists it in `img-src`/`connect-src` when
  configured (LAI-1300). Upload headers must be sent exactly as signed or the store answers
  403.
- `OrgView.attachments` is read from the cached `/org` the web already holds.

## Build notes (build-1301, for review)

- **Claimed before LAI-1300 was in `done/`**, on CHIEF's dispatch: both halves were built in
  parallel, and this branch merges `LAI-1300-attachments-server` (last at `78dc9eb78`). PR #353
  is stacked on #352 and says so.
- **`api/attachments.ts` is LAI-1300's** (types, JSON calls, `Org.attachments`, the stream
  verbs, the `/content` coverage exemption, the view-type-drift pairs). This task's upload half
  is `api/attachment-upload.ts`: the `XMLHttpRequest` `PUT` with progress and the ask → PUT →
  complete orchestration, with the too-large refusal before asking. Criterion 1 is met across
  the two files.
- **`paste.ts` still drops every `<img>` but Laika's own attachment** (and keeps a link to one),
  so cutting a screenshot and pasting it lower down keeps it. Any other pasted image, a `data:`
  URL, or the attachment path on another host is dropped as before.
- Beyond the criteria: Save (and Create task) waits while a file is uploading; a paste that also
  carries text is the text (a spreadsheet's picture is not uploaded); the Markdown-view snippet
  is written by the bridge so the text still opens rich; a `doc` glyph besides the five named.
- CI on PR #353: every Gate job pass (cli, lint/format, server 1–4, web 1–4) at `310c5dcf6`.

