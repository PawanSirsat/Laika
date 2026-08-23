---
id: LAI-024
title: Production build and start scripts for the server
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-002]
discovered-from: LAI-002
status: backlog
---

## Goal

`server` has `dev`, `typecheck` and `test`, but no `build` and no `start`. LAI-008
needs both to put the server in a container, and its own notes forbid Builder-B
from adding them ("If the build needs a change inside `server/`, do not make it —
file a task"). This is that task.

## Acceptance criteria

- [ ] `pnpm --filter @laika/server build` emits runnable JavaScript to
      `server/dist/`, and the root `pnpm build` picks it up.
- [ ] `pnpm --filter @laika/server start` runs the built output under plain
      `node`, with no TypeScript loader and no experimental flag.
- [ ] The built output resolves `server/src/static/fallback.html` correctly — it
      is a non-TypeScript asset that a `tsc` emit does not copy, and the SPA
      fallback is broken in the container if it is missing.
- [ ] `SIGTERM` to the started process exits 0 within the grace period (the
      LAI-002 shutdown path, exercised against the built artefact).
- [ ] `GET /api/v1/health` answers from the built output.

## Notes / context

Discovered implementing LAI-002.

**The signal finding, which is the reason `start` must not wrap anything.**
Verified during LAI-002: `SIGTERM` to a server run under `tsx` exits **143** and
the shutdown handler never runs, because `tsx` forks a child and does not forward
the signal. The same server run under plain `node` logs `shutdown.start` →
`shutdown.complete` and exits **0**. So the container entrypoint must be `node`
directly — not `tsx`, not `pnpm start`, not a shell wrapper — or `docker stop`
waits out its timeout and escalates to `SIGKILL` on every deploy. Worth stating
in `docker/README.md` too (LAI-008).

`server/tsconfig.json` already sets `rewriteRelativeImportExtensions`, so the
`.ts` specifiers in source are rewritten to `.js` on emit and the output is valid
Node ESM. A build config (`tsconfig.build.json` with `noEmit: false`, `outDir`,
`include: ["src"]`) is most of the work.

Node 22 can also run the TypeScript sources directly via
`--experimental-strip-types`; verified working during LAI-002. Rejected as the
production path — an experimental flag is not something to depend on in a
container — but it is a reasonable fallback if the emit route turns out painful.

No new dependencies. If a bundler is genuinely needed, that is a separate task.
