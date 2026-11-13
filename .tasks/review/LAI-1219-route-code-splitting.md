---
id: LAI-1219
title: 'Route-level code splitting for the web app'
area: web
assignee: shell
priority: p1
depends-on: []
status: review
started: 2026-11-13T07:33:26Z
finished: 2026-11-13T08:46:55Z
---

## Goal

Every screen ships in one large entry chunk (about 522 KB gzipped at the
Phase 1 audit; `docs/ux/architecture/component-architecture.md` §1). Load
screens on demand through `routes/route-table.ts` and
`components/shell/ScreenOutlet.tsx`, keeping the app shell, sidebar, auth
bootstrap, theme, API client, stores and SSE hub in the entry chunk.

## Acceptance criteria

- [x] Each screen is lazy (`React.lazy` + dynamic `import()`) through the
      route table and `ScreenOutlet`; tightly related groupings are justified
      in the log.
- [x] While a screen chunk loads, the shared loading state shows after a
      delay (fast loads show nothing); a chunk that fails to load shows the
      shared error state with Try again, which retries the import — never a
      blank page.
- [x] A screen's chunk is warmed on sidebar or tab hover, focus or
      pointerdown, and the default screen is preloaded after first paint; no
      other extra requests on initial load.
- [x] Strict CSP still holds — no inline script, no `eval`, no inline
      module-preload script — checked in a browser test counting
      `securitypolicyviolation` events.
- [x] Entry chunk gzip size before and after, and the largest remaining
      chunk, recorded in the log from `pnpm --filter ./server/web build`; a
      size guard test fails past a stated budget, verified by breaking it once.
- [x] Browser tests: navigate to a lazy screen; the delayed loading state;
      chunk failure recovered by Try again; deep link straight to a lazy
      screen. Existing browser tests keep passing; adjusted waits listed in
      the log.
- [x] No new dependencies, no router replacement, permissions stay
      server-driven, both themes.
- [x] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Builder notes (SHELL, 2026-11-13)

Log: `logs/shell-2026-11-13-LAI-1219.md` — measurements, groupings, decisions,
mutations.

- **Entry chunk:** 656.46 kB → 136.62 kB gzip (Vite's figure); everything the
  first page loads, by `bundle-budget.test.ts`'s zlib measure, 662,916 B →
  134,915 B against a 153,600 B budget.
- **CSS is deliberately not split.** Screens depend on stylesheets only other
  screens import (the board's lane layout lives in a file only Activity
  imported), so the entry stylesheet is kept rule for rule as it was —
  verified against a build of 844319cc. Splitting it is LAI-1133.
- **Try again** retries at `?retry=N`, because Chromium caches a failed module
  fetch; a second failure's Try again reloads.
- **Existing tests adjusted** (both assumed one script bundle):
  `test/browser/my-day-v2.test.ts` ("no mockup data (2)") and
  `test/browser/board-sprint-stats.test.ts` (its `**/presence*` hold matched
  `assets/presence-*.js`). No waits changed.
- A space view's chunk fallback is the neutral `card` skeleton: a
  board-shaped one flashed up before the board's own held skeleton
  (`board-refresh.test.ts`'s hold test, under load).
