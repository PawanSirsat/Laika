---
id: LAI-017
title: Vite + React scaffold in server/web, building into server/public
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-001]
discovered-from:
status: in-progress
started: 2026-08-24T03:32:35+05:30
---

## Goal

Stand up the frontend workspace so every later UI task has somewhere to land: a
React 19 + TypeScript + Vite app at `server/web/`, building to `server/public/`,
with a dev server that proxies the API. **No API calls, no screens** — this is
the ground the shell is built on.

## Acceptance criteria

- [ ] `server/web/` is a pnpm workspace package: React 19, TypeScript, Vite,
      extending the root `tsconfig.base.json` with `strict` intact.
- [ ] `pnpm build` from the repo root outputs to `server/public/` — which stays
      gitignored (LAI-016). Nothing is ever committed into it.
- [ ] `pnpm dev` runs Vite with `/api`, `/mcp` and `/webhooks` proxied to
      `localhost:3000`, so the app works the moment a server exists.
- [ ] `pnpm typecheck` and `pnpm lint` cover `server/web/` and pass.
- [ ] A single placeholder route renders and says what it is. No fake data, no
      screens, no lorem.
- [ ] Fonts **self-hosted**: Plus Jakarta Sans (400–800) and JetBrains Mono
      (500–700) served from our own assets, never from Google (SPEC §13.4).
- [ ] `pnpm build` output loads with **zero external network requests** —
      verified, not assumed.

## Notes / context

Milestone: **M1**. **API-independent — startable now** (CLAUDE.md §5.1).
**Builder-B owns `server/web/`** (D-016).

Do not add a component library, state manager, or data-fetching library. Routing
arrives in LAI-019, theming in LAI-018. Dependencies this task may add: `react`,
`react-dom`, `@vitejs/plugin-react`, `vite`, and the two font packages.

Read `docs/design/README.md` before starting.
