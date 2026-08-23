---
id: LAI-023
title: Add a build script to @laika/server so the image stops open-coding tsc
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-008
status: backlog
---

## Goal

`@laika/server` has `dev`, `typecheck`, `test` and `db:generate`, but no
`build`. The Docker image needs compiled JavaScript, so `docker/Dockerfile`
currently invokes `tsc` itself with flag overrides. That works — the image
builds, boots and serves — but it puts the definition of how the server is
built inside Builder-B's Dockerfile, where Builder-A will not see it when
`server/` changes.

Two things make the open-coded version fragile:

- `server/tsconfig.json` sets `noEmit` (inherited from `tsconfig.base.json`) for
  typechecking, so emit has to be forced with `--noEmit false`.
- Its `include` covers `test/**` and `vitest.config.ts` as well as `src/`, and
  `--project` cannot be narrowed with file arguments (TS5042). The Dockerfile
  compiles everything and then ships only `dist/src`, which is a workaround, not
  a build.

## Acceptance criteria

- [ ] `@laika/server` has a `build` script producing runnable JavaScript from
      `src/` only — no `test/`, no `vitest.config`, no `drizzle.config`.
- [ ] `pnpm --filter @laika/server build` succeeds from the repo root and from a
      clean checkout with no prior build.
- [ ] The generated migrations (`src/db/migrations/**`, both `.sql` and
      `meta/*.json`) end up where `migrate.ts` resolves them — beside the
      compiled module, i.e. `dist/db/migrations`. `tsc` does not copy non-TS
      assets, and without this the server starts and dies with
      "Can't find meta/_journal.json". This is the part most likely to be missed.
- [ ] `src/static/fallback.html` is likewise available to the built server —
      `paths.ts` resolves it from the package root, so either it stays at
      `src/static/` in the deployed tree or the build copies it.
- [ ] Build output is gitignored and never committed.
- [ ] `node dist/index.js` (or whatever the entry becomes) boots, applies
      migrations, and answers `GET /api/v1/health` — with no `tsx` present.

## Notes / context

Discovered while building the image for LAI-008. **Not blocking**: `docker/`
compiles the server itself today and the container works end to end.

Once this lands, the `server` stage in `docker/Dockerfile` collapses to
`RUN pnpm --filter @laika/server build` and the flag overrides are deleted. That
follow-up is `area: docker` and Builder-B's — please file it rather than editing
the Dockerfile.

A `tsconfig.build.json` extending the existing config with `noEmit: false`, an
`outDir`, and `include: ["src/**/*.ts"]` is the obvious shape, but the choice is
Builder-A's.

No new dependencies needed — `typescript` is already a devDependency.
