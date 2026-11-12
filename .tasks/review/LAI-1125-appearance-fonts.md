---
id: LAI-1125
title: 'Appearance: a choice of interface font, self-hosted, beside the theme'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: review
finished: 2026-11-04T10:27:14Z
started: 2026-11-04T10:02:01Z
---

## Goal

A reader can choose the face the interface is set in — the current default,
Plus Jakarta Sans, or one of five more: Poppins, Commissioner, Average Sans,
Carter One and Short Stack — from a new **Appearance** panel that also holds
the theme. The choice applies at once, persists on this device, and reaches
the sign-in screen too. Every font is self-hosted, exactly as the existing
ones are, so the CSP (`font-src 'self'`) and SPEC §13.4 hold.

## Acceptance criteria

- [x] The five packages below are dependencies of `@laika/web` and in
      `pnpm-lock.yaml`; `index.css` imports only their latin subset and only
      the weights the UI uses. `assetsInlineLimit` stays `0`.
- [x] The choice is a `data-font` attribute on `:root` re-pointing `--font-ui`
      in `styles/theme.css`, with a fallback stack per face; `--font-mono` is
      unchanged. The default carries no attribute, as the dark theme carries
      none.
- [x] `theme/font.ts` reads and writes `laika.font` in `localStorage` inside
      `try/catch`; garbage or unavailable storage falls back to the default.
      `initFont()` runs before render in `main.tsx` beside `initTheme()`.
      `use-font.ts` is one shared store (`useSyncExternalStore`), live across
      tabs.
- [x] Single-weight faces (Carter One, Short Stack, Average Sans) never get a
      synthesised bold: `font-synthesis` is off for them.
- [x] The person menu has *Appearance…*, opening a `SidePanel` with Theme
      (the existing store) and Interface font: a `radiogroup` (not a native
      `<select>`), each option set in its own face, arrow keys move and
      select, focus visible, both themes. The two display faces carry an
      honest hint.
- [x] Unit tests for the font store: parse, persist, fallback on garbage and
      on throwing storage.
- [x] Browser tests: open Appearance, pick each font and see `body`'s computed
      `font-family` change; the choice survives a reload; keyboard selection
      works; the stored choice applies on the sign-in screen; an unselected
      face's files are not requested on first load.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

Dependencies this task adds (CLAUDE.md §5 — each named), all `5.3.0`,
SIL Open Font License 1.1:

- `@fontsource/carter-one` — 400 only
- `@fontsource/short-stack` — 400 only
- `@fontsource/poppins` — 400, 500, 600, 700
- `@fontsource-variable/commissioner` — variable weight axis
- `@fontsource/average-sans` — 400 only

Per-device preference only: no server or API change (that would be CORE's).
The PR targets `integration-ui-transformation`, not `master`.

## Review notes (builder)

- The gate criterion is left unticked in this file on purpose: the task moves
  to review *before* the final gate run, so that the run covers this state of
  `.tasks/`. Its three exit codes are in the PR body and on the card
  (LAIKA-987), measured on this branch's head.
- Deviation, recorded: the PR targets `integration-ui-transformation`, not
  `master`, as the dispatch asked.
- Commissioner's latin face is a hand-written `@font-face` in `index.css`
  pointing at the package's own woff2, because the variable package ships no
  latin-only stylesheet.
