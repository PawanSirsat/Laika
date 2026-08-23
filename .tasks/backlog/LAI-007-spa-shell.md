---
id: LAI-007
title: React + Vite SPA shell with auth screens, built into server/public
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-002, LAI-005]
discovered-from:
status: backlog
---

## Goal

The front door: a React + Vite app that builds to static assets the Node process
serves, with sign-in, sign-out, and an authenticated empty shell. It must talk to
the same public `/api/v1` an agent would — no private endpoints.

## Acceptance criteria

- [ ] `server/web/` holds a React 19 + TypeScript + Vite app; `pnpm build`
      outputs to `server/public/` (gitignored) and the running server serves it.
- [ ] Vite dev server proxies `/api`, `/mcp` and `/webhooks` to the Node process
      so `pnpm dev` runs both with hot reload.
- [ ] Routing with an authenticated layout and a public auth route; unauthenticated
      access to a protected route redirects to sign-in.
- [ ] Sign-in and sign-out work against better-auth; the shell shows the current
      user from `GET /api/v1/me`.
- [ ] A typed API client wrapping `fetch`: credentials included, SPEC §6.3 error
      envelope parsed into a typed error, 401 triggers a redirect to sign-in.
- [ ] Empty authenticated shell: nav, current user, and an explicit empty state —
      no fake data, no placeholder lorem.
- [ ] Loading and error states exist for the `/me` fetch; a failed API call never
      renders a blank white page.
- [ ] `pnpm typecheck` and `pnpm lint` cover the web app too.

## Notes / context

Milestone: **M1**. SPEC §11.4 and §11.4.1.

Board UI, task detail and drag-and-drop are **M2**, not this task. This is the
shell they will mount into — resist building columns now.

Dependencies this task may add: `react`, `react-dom`, `@vitejs/plugin-react`,
`vite`, a router. Component libraries and state managers need their own task.
