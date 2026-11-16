---
id: LAI-1228
title: 'Hanken Grotesk as an Interface font choice on the Appearance page'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1125, LAI-1212]
discovered-from:
status: in-progress
started: 2026-11-16T18:00:00Z
---

## Goal

Owner request: add **Hanken Grotesk** (the Google Fonts selection: upright and
italic, weights 100–900) to the Interface font picker on the Appearance page,
self-hosted, following exactly the pattern LAI-1125 and LAI-1212 used for the
existing six faces.

Built on local `ui-round9` @bcca9682. LAI-1227 reworks the top bar and
sidebar footer in parallel; this task touches no header or sidebar file.

## Acceptance criteria

- [ ] Self-hosted only (CSP `font-src 'self'`, SPEC §13.4): the variable
      package's latin subset, upright and italic, from our own assets; no
      latin-ext file and no request to Google.
- [ ] `@fontsource-variable/hanken-grotesk` pinned exactly `5.3.0` in
      `server/web/package.json`, lockfile updated.
- [ ] A new card in the Interface font picker, previewed in its own face with
      the sample line, with the same arrow-key behaviour as the others.
- [ ] Persists like the others (`laika.font`), and applies before first paint
      through `public/theme-boot.js` — the sign-in screens included. JetBrains
      Mono stays for code and keys.
- [ ] Lazy: its files download only when it is the face in use; the browser
      test that holds "unselected faces are never downloaded" covers it, and
      the bundle budget test stays green.
- [ ] Real weights 100–900 and a real italic, so no synthesis switch and no
      caveat note.
- [ ] Layout checked at 390 and 1440 (truncation, board cards, tables).
- [ ] Tests: unit (registry, CSS agreement, pin) and browser (pick, reload
      persists, network shows only its files, keyboard); one behaviour broken
      and seen red.

## Notes

- **Dependency, named per CLAUDE.md §5:** `@fontsource-variable/hanken-grotesk`
  at exactly `5.3.0`, licence OFL-1.1 (verified on npm and in the package's
  own `package.json`).
- Files in scope: `server/web/src/index.css`, `src/styles/theme.css`,
  `src/theme/font.ts`, `src/theme/token-list.ts`, `public/theme-boot.js`,
  `server/web/package.json`, `pnpm-lock.yaml`, `test/theme/font.test.ts`,
  `test/browser/appearance-page.test.ts`.
- The Appearance screen reads `FONTS`, so it needs no edit.
