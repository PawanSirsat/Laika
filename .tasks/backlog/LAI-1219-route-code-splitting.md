---
id: LAI-1219
title: 'Route-level code splitting for the web app'
area: web
assignee: unclaimed
priority: p1
depends-on: []
status: backlog
---

## Goal

Every screen ships in one large entry chunk (about 522 KB gzipped at the
Phase 1 audit; `docs/ux/architecture/component-architecture.md` §1). Load
screens on demand through `routes/route-table.ts` and
`components/shell/ScreenOutlet.tsx`, keeping the app shell, sidebar, auth
bootstrap, theme, API client, stores and SSE hub in the entry chunk.

## Acceptance criteria

- [ ] Each screen is lazy (`React.lazy` + dynamic `import()`) through the
      route table and `ScreenOutlet`; tightly related groupings are justified
      in the log.
- [ ] While a screen chunk loads, the shared loading state shows after a
      delay (fast loads show nothing); a chunk that fails to load shows the
      shared error state with Try again, which retries the import — never a
      blank page.
- [ ] A screen's chunk is warmed on sidebar or tab hover, focus or
      pointerdown, and the default screen is preloaded after first paint; no
      other extra requests on initial load.
- [ ] Strict CSP still holds — no inline script, no `eval`, no inline
      module-preload script — checked in a browser test counting
      `securitypolicyviolation` events.
- [ ] Entry chunk gzip size before and after, and the largest remaining
      chunk, recorded in the log from `pnpm --filter ./server/web build`; a
      size guard test fails past a stated budget, verified by breaking it once.
- [ ] Browser tests: navigate to a lazy screen; the delayed loading state;
      chunk failure recovered by Try again; deep link straight to a lazy
      screen. Existing browser tests keep passing; adjusted waits listed in
      the log.
- [ ] No new dependencies, no router replacement, permissions stay
      server-driven, both themes.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
