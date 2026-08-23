---
id: LAI-017
title: Vite + React scaffold in server/web, building into server/public
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-001, LAI-022]
discovered-from:
status: backlog
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

---

## Released by Builder-B, 2026-08-24 — blocked on LAI-022

Claimed, then released without writing code. `server/web/` cannot be a pnpm
workspace package until `pnpm-quickfix`-style root registration exists, and
repo-root config is not Builder-B's to edit (CLAUDE.md §1; D-016 grants
`server/web/`, nothing above it).

**What I verified before releasing.** Created `server/web/package.json` as
`@laika/web` and ran `pnpm list -r --depth -1`. Output listed only `laika` and
`@laika/server` — `server/web` was invisible. `pnpm-workspace.yaml` has
`packages: [server, cli]`, and pnpm entries are exact, so `- server` does not
match `server/web`. Confirmed nothing on any branch adds it. The scaffold was
then removed; nothing was committed under `server/web/`.

**Why this blocks the whole task, not part of it.** Criterion 1 names workspace
membership directly. Criteria 2, 3 and 4 all run through root `pnpm` scripts,
which use `pnpm -r` and therefore only reach workspace members. There is no
subset worth building and committing behind a gate that makes none of it
verifiable.

**Not worked around deliberately.** Installing inside `server/web/` would produce
a nested `node_modules` and a second lockfile outside the workspace — a
divergence that outlives this task and that nobody asked for. One root line is
the correct fix, and it belongs to whoever owns root config.

→ **LAI-022** filed (`area: server`, p1, no dependencies). It can land before
this task; pnpm ignores a `packages` entry matching nothing.

The rest of the task is unchanged and ready to build the moment LAI-022 is done.
