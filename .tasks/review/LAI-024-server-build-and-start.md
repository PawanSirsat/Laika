---
id: LAI-024
title: Production build and start scripts for the server
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-002]
discovered-from: LAI-002
status: review
started: 2026-08-24T04:29:04+05:30
finished: 2026-08-24T04:31:49+05:30
---

## Goal

`server` has `dev`, `typecheck` and `test`, but no `build` and no `start`. LAI-008
needs both to put the server in a container, and its own notes forbid Builder-B
from adding them ("If the build needs a change inside `server/`, do not make it —
file a task"). This is that task.

## Acceptance criteria

- [x] `pnpm --filter @laika/server build` emits runnable JavaScript to
      `server/dist/`, and the root `pnpm build` picks it up.
- [x] `pnpm --filter @laika/server start` runs the built output under plain
      `node`, with no TypeScript loader and no experimental flag.
- [x] The built output resolves `server/src/static/fallback.html` correctly — it
      is a non-TypeScript asset that a `tsc` emit does not copy, and the SPA
      fallback is broken in the container if it is missing.
- [x] `SIGTERM` to the started process exits 0 within the grace period (the
      LAI-002 shutdown path, exercised against the built artefact).
- [x] `GET /api/v1/health` answers from the built output.

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

---

## Notes at review — builder-a

**204 tests pass**, lint, typecheck and `pnpm format` clean. The build is
exercised by a test that actually builds and actually runs the artefact:
`test/tooling/build.test.ts` runs `pnpm build`, then spawns
`node dist/index.js` — plain `node`, no loader, no experimental flag, exactly as
the container will — and asserts health, the SPA fallback, that the database was
migrated, and `SIGTERM → exit 0`.

**1. `tsc` copies no non-TypeScript files, and two of them are load-bearing.**
The SPA fallback document and the generated `.sql` migrations are both resolved
at runtime, and neither appears in `dist/` from a compile alone. Both failures
are production-only: every test passes locally because `src/` is still on disk,
and the container — which ships `dist/` alone — 500s on the fallback and boots
against an unmigrated database. `build:assets` copies both.

**2. `paths.ts` now anchors shipped assets to the module, not to `src/`.**
`FALLBACK_DOCUMENT` resolves from `CODE_ROOT` (`import.meta.url`'s directory), so
it is `src/static/…` under `tsx` and `dist/static/…` once built. `PUBLIC_DIR`
still resolves from the package root, because `public/` sits beside `src/` and
`dist/` rather than inside either. Two anchors, and the comment says why.

**3. The test was checked for teeth.** I removed the `src/static` half of
`build:assets` and re-ran: the artefact check failed *and* the running server
failed to serve the fallback. Restored, both pass. A build test that has never
been seen red proves nothing about a build step.

**4. `rewriteRelativeImportExtensions` is what makes this work at all**, and it
has its own assertion. LAI-001 mandated `moduleResolution: bundler`, which lets
source say `./app.ts`; without the rewrite the emit keeps `.ts` and Node throws
`ERR_MODULE_NOT_FOUND` on the first import. I flagged this exact risk in the
LAI-001 log — this is where it landed, and it cost nothing because
`server/tsconfig.json` already set the option in LAI-002.

**5. The container entrypoint must be `node dist/index.js`.** Not `pnpm start`,
not `tsx`, not a shell wrapper: verified back in LAI-002 that `SIGTERM` under
`tsx` exits **143** without ever running the shutdown handler, because tsx forks
and does not forward the signal. `pnpm start` has the same shape. `docker/`
already runs an entrypoint script — worth a check that the final `exec` is
`node`, which is Builder-B's call and not something I touched.

**6. `dist/` is gitignored** and carries no `.test.js` — asserted, because
`tsconfig.build.json` excluding tests is easy to lose in a later edit.

**Not done here:** `docker/Dockerfile` consuming this. LAI-008 is already
accepted, so if its build stage needs adjusting to call `pnpm --filter
@laika/server build` and copy `dist/`, that is a Builder-B change and belongs in
its own task.
