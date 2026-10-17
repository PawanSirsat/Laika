---
id: LAI-760
title: 'Copy buttons copy nothing on the live board, which is plain HTTP and not a secure context (server/web/)'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-17T06:52:04Z
status: review
finished: 2026-10-17T07:06:32Z
---

## Goal

**Made on the owner's direct instruction** (Pawan Sirsat, 2026-10-17, through
the orchestrator), single-agent mode, on the temporary branch `build-copy-fix`
cut from `master` `401191b`. Board card LAIKA-566. Changes `server/web/` only.
Not pushed, not merged: the orchestrator reviews and merges.

The owner reported that the Copy buttons on the live board put nothing on the
clipboard. The board is served over plain HTTP on an IP, which is not a secure
context, so `navigator.clipboard` is `undefined` there. `CopyButton` (LAI-622)
already knew this and fell back to selecting the text and showing *Press ⌘C*,
so every Copy on the Connect screen, the BOARD address chip, the *Share local
activity* command and the Tokens screen copied nothing. When this is finished,
a click copies the text on that board too.

## Acceptance criteria

- [x] One shared copy helper (`copyText` in
      `server/web/src/components/CopyButton.tsx`) is the only clipboard path,
      and every copy control in `server/web/src/` goes through it: every
      `CopyButton`, and the task panel's *Copy link* and overflow *Copy task
      key* / *Copy link to this task*.
- [x] It uses `navigator.clipboard.writeText` when it exists. When it does not,
      and also when it rejects, it copies through a temporary off-screen
      read-only textarea, `select()` and `document.execCommand('copy')`. When
      the API is absent that runs synchronously inside the click, so it keeps
      the user gesture. The previous focus and selection are restored after.
- [x] The temporary textarea goes inside the nearest open dialog
      (`[aria-modal="true"]`, `[role="dialog"]`, `dialog[open]`) when the
      control is in one, and `<body>` otherwise.
- [x] Success shows the existing *Copied ✓*. When both paths fail the button
      says *Press ⌘C to copy* (Mac) or *Press Ctrl+C to copy* (elsewhere) and
      selects the text; it never says *Copied* when nothing was copied. The
      screen-reader announcements stay.
- [x] What each control copies is unchanged.
- [x] A browser test serves the app on a non-secure origin
      (`http://laika.test:<port>`, mapped to `127.0.0.1` by Chromium's
      `--host-resolver-rules`), asserts `isSecureContext === false`, clicks,
      and reads the clipboard back. It covers the Connect setup prompt, a
      command block, the BOARD chip, and a copy control inside a dialog (the
      task panel). It fails on the code before this change and passes after,
      shown once.
- [x] `pnpm test`, `pnpm lint` and `pnpm format` each exit 0 after the last
      edit.

## Notes / context

- SHELL's area (`server/web/`). No new dependency: Playwright is already a
  dev dependency of `@laika/web`.
- `document.execCommand('copy')` is deprecated but is the only clipboard write
  a page that is not a secure context has. It is the fallback, never the first
  choice.
- The column dialogs (`NewColumnDialog`, `DeleteColumnDialog`,
  `HiddenColumnsDialog`) hold no copy control today; the dialog rule covers
  them if one is added.

## Done

- `c4ff58a` — `copyText` (`server/web/src/components/CopyButton.tsx`) falls back
  to a scratch textarea and `execCommand('copy')`, inside the nearest dialog;
  `CopyButton` passes itself, says *Press ⌘C to copy* / *Press Ctrl+C to copy*
  only when both fail, and selects the `selects` element or the nearest
  `code`/`pre` showing exactly the text. The task panel's three copies pass
  their button. `.copy-scratch` in `copy-button.css`.
- Test: `server/web/test/browser/copy-insecure.test.ts` (harness option
  `insecure`, `http://laika.test:<port>`). Red on `fa32d69` (the code before
  the fix): 5 of 5 failed, each with the sentinel still on the clipboard or
  the old *Press ⌘C* label; green after.
- Two Connect tests asserted the old behaviour (no API ⇒ *Press ⌘C*); they
  now also refuse `execCommand` so they test the case that is left, and
  accept either key name. `copy-button.test.ts`'s source guard now pins the
  fallback and its order before any `await`.
- **Not this task, fixed because it blocked the gate:** `connect.test.ts`
  *the optional entries open in the card…* read *Share local activity* during
  its loading spinner and failed on `master` `401191b` as well (measured on an
  extracted copy of that commit). It now waits for the spinner to go.
