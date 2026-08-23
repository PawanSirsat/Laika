---
id: LAI-017
title: Vite + React scaffold in server/web, building into server/public
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-001, LAI-200]
discovered-from:
status: review
finished: 2026-08-24T04:51:27+05:30
started: 2026-08-24T04:41:44+05:30
---

## Goal

Stand up the frontend workspace so every later UI task has somewhere to land: a
React 19 + TypeScript + Vite app at `server/web/`, building to `server/public/`,
with a dev server that proxies the API. **No API calls, no screens** — this is
the ground the shell is built on.

## Acceptance criteria

- [x] `server/web/` is a pnpm workspace package: React 19, TypeScript, Vite,
      extending the root `tsconfig.base.json` with `strict` intact.
- [x] `pnpm build` from the repo root outputs to `server/public/` — which stays
      gitignored (LAI-016). Nothing is ever committed into it.
- [x] `pnpm dev` runs Vite with `/api`, `/mcp` and `/webhooks` proxied to
      `localhost:3000`, so the app works the moment a server exists.
- [x] `pnpm typecheck` and `pnpm lint` cover `server/web/` and pass.
- [x] A single placeholder route renders and says what it is. No fake data, no
      screens, no lorem.
- [x] Fonts **self-hosted**: Plus Jakarta Sans (400–800) and JetBrains Mono
      (500–700) served from our own assets, never from Google (SPEC §13.4).
- [x] `pnpm build` output loads with **zero external network requests** —
      verified, not assumed.

## Notes / context

Milestone: **M1**. **API-independent — startable now** (CLAUDE.md §5.1).
**Builder-B owns `server/web/`** (D-016).

Do not add a component library, state manager, or data-fetching library. Routing
arrives in LAI-019, theming in LAI-018. Dependencies this task may add: `react`,
`react-dom`, `@vitejs/plugin-react`, `vite`, and the two font packages.

Read `docs/design/README.md` before starting.

---

## Released by Builder-B, 2026-08-24 — blocked on LAI-200

Claimed, then released without writing code. `server/web/` cannot be a pnpm
workspace package until it is listed in the root `pnpm-workspace.yaml`, and
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

→ **LAI-200** filed (`area: server`, p1, no dependencies). It can land before
this task; pnpm ignores a `packages` entry matching nothing.

The rest of the task is unchanged and ready to build the moment LAI-200 is done.


---

## Implementation notes for review (Builder-B) — 2026-08-24

Claimed again once LAI-200 landed, and built. Every criterion was exercised;
the network one was checked in a real browser, not by reading the bundle.

### Verified

- **Workspace + strict**: `pnpm list -r` shows `@laika/web@0.1.0` at
  `server/web`; React **19.2.8**; `tsc --showConfig` confirms `strict`,
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` all inherited
  from `tsconfig.base.json` and none overridden.
- **Build target**: root `pnpm build` emits to `server/public/`;
  `git check-ignore` confirms it is ignored and `git status` shows nothing from
  it. Nothing committed there.
- **Dev proxy**: with the API on :3000, through Vite on :5173 —
  `/api/v1/health` returns the health JSON, `/webhooks/github` and `/mcp` both
  return the API's JSON 404 envelope (so they are proxied, not swallowed by the
  SPA), and `/projects/foo` still serves the app.
- **Placeholder**: renders, states what it is, holds no invented data.
- **Fonts self-hosted**: 10 woff2 files emitted into `assets/`; the built CSS
  references only `/assets/…`; no `googleapis`/`gstatic` string anywhere in the
  output.
- **Zero external requests — verified in a browser.** Served the build through
  the real server and loaded it under Playwright. All five requests:
  `/`, `/assets/index-*.js`, `/assets/index-*.css`, and the two woff2 — every
  one to our own origin. The only absolute URLs in the bundle are XML
  namespace identifiers and React's error-docs string, none of which are
  fetched.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.
`pnpm test`: **249 passed, 1 failed** — see below.

### The one red test is not this task's defect

`server/test/tooling/build.test.ts:100` asserts the SPA **fallback** text
(`'Laika is running.'`). That document is served only when
`server/public/index.html` is absent (LAI-016). This task builds a real SPA into
`server/public/`, so the server now correctly serves that instead.

Proven state-dependent, on identical source:

| `server/public/` | Result |
| --- | --- |
| absent | `Tests 6 passed (6)` |
| present | `Tests 1 failed \| 5 passed (6)` |

So the test passes in CI and fails for anyone who has run `pnpm build` — it
depends on untracked local state. `server/test/` is Builder-A's, so I did not
touch it. → **LAI-204** filed (`area: server`, p1), with both runs recorded.

I moved this to review rather than holding it: the failure is provably outside
this task's area, the server's behaviour is exactly what LAI-016 specified, and
parking LAI-017 blocks LAI-018 through LAI-021 and LAI-007 a second time.
PM's call if you disagree.

### Two decisions worth a look

- **`allowImportingTsExtensions` without `rewriteRelativeImportExtensions`.**
  Imports carry explicit `.ts`/`.tsx` extensions to match `server/`, one
  convention across the repo. The rewrite half is deliberately absent: it exists
  in `server/` so `tsc` emits Node-resolvable ESM, whereas nothing is emitted
  from this package — Vite bundles, and `noEmit` is what makes the flag legal.
- **`types: ["vite/client"]`, not `["node"]`.** This code runs in a browser.
  Pulling Node's globals in would let `process.env` typecheck here and fail at
  runtime.

### Dependencies

Exactly the six the task allows — `react`, `react-dom`, `@vitejs/plugin-react`,
`vite`, and the two font packages (`@fontsource-variable/plus-jakarta-sans`,
`@fontsource-variable/jetbrains-mono`; the variable builds cover 200–800 and
100–800, so the design's 400–800 and 500–700 are both inside range) — **plus
three the task does not name**: `typescript`, `@types/react`, `@types/react-dom`.
Declared openly rather than slipped in: strict-mode React cannot compile without
the two `@types` packages, and `typescript` must be a package-level devDependency
for `tsc` to resolve under `node-linker=isolated`. They are type declarations and
a compiler for dependencies already allowed, not new capability. Say the word if
you want them removed and the criterion renegotiated instead.

### Deliberately not done

No component library, state manager, or data-fetching library. No design tokens:
duplicating a subset of `docs/design/README.md`'s palette here would mean two
sources of truth for a colour the day LAI-018 lands. `index.css` carries only
the two font families and enough to prove the scaffold renders.
