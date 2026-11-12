---
id: LAI-1212
title: 'Appearance as a full page: Light, Dark, Black and System themes'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1125, LAI-1126, LAI-1132]
discovered-from:
status: review
finished: 2026-11-12T15:30:00Z
started: 2026-11-12T09:00:00Z
---

## Goal

Owner, verbatim: *"Keep the dark theme into the black color itself, or give
options into the appearances, make sure to work onto the appearances as a page
not as a sheet, and improve its UX."*

Appearance moves from the person-menu side panel to a real page, and gains a
true-black theme for OLED screens beside Light and Dark, plus System with a
choice of which dark variant it follows.

Built on `origin/ui-merge-train` @31a94fad — the 26 open UI PRs (#267..#335)
merged in order, including #268 fonts (LAI-1125), #269 brand (LAI-1126) and
#291 glass (LAI-1132). Merge after #335.

## Acceptance criteria

- [x] A **Black** theme in `styles/theme.css`: `#000000` canvas, near-black
      elevated surfaces, text and borders tuned for contrast, subtle neutral
      glass (no blue haze). Every themed token is declared for it.
- [x] The token, contrast, glass-contrast and single-source tests cover Black
      and pass; reduce-transparency and forced-colors fallbacks hold in Black.
- [x] **System** follows `prefers-color-scheme`, and the reader chooses which
      dark variant it uses (Dark or Black); unit tests cover resolution and
      storage, including unreadable storage and garbage values.
- [x] The stored theme is on `:root` before first paint with no inline script
      (strict CSP): a classic same-origin script in `<head>`.
- [x] `/settings/appearance` is a route for any signed-in user, reached from
      the person menu ("Appearance…") and the ⌘K palette (Go to, and Switch
      theme). The side panel and its tests are gone; the page has its own.
- [x] The page: header and intro; **Theme** as large live-preview cards in a
      radio group with arrow keys; **Interface font** as cards set in their
      own face with the caveats inline; **Motion & transparency** stating what
      the app follows; "Saved on this device" status; "Reset to defaults".
- [x] Works at 390 / 768 / 1440 in every theme, keyboard and screen reader,
      reduced motion; zero CSP violations.
- [x] The sign-in screens respect the chosen theme.
- [x] Gates: `pnpm lint`, `pnpm format`, web typecheck, web shards 1–4, the
      server structure + task-file-state tests — each exit 0.

## Notes

- Design advice taken from the `impeccable`, `emil-design-eng`,
  `apple-design` and `break-ui` skills; repo rules win.
- No new dependencies. Colours only in `styles/theme.css` / `theme.ts`.
- Density is omitted: no density mechanism exists in the app.
