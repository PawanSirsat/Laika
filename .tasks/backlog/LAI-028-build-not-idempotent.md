---
id: LAI-028
title: '`pnpm build` is not idempotent — a second run nests the copied assets'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-024
status: backlog
---

## Goal

`server/package.json`'s `build:assets` step is:

```
cp -R src/static dist/static && cp -R src/db/migrations dist/db/migrations
```

`cp -R src dest` copies *into* `dest` when `dest` already exists. So the first
build is correct and every subsequent build without a clean adds a level:

```
build 1:  dist/static/fallback.html                    ✅
build 2:  dist/static/fallback.html                    ✅
          dist/static/static/fallback.html             ← junk
          dist/db/migrations/migrations/...            ← junk
```

Make the build produce the same tree every time it runs.

## Acceptance criteria

- [ ] Running `pnpm build` twice in a row, with no clean between, produces a
      `dist/` tree **identical** to a single clean build. Assert it — e.g.
      compare `find dist | sort` across the two runs.
- [ ] `dist/static/static/` and `dist/db/migrations/migrations/` never appear.
- [ ] The fix does not weaken LAI-024: `fallback.html` and the generated
      migrations still land beside the compiled modules, and the built server
      still serves the SPA fallback and applies migrations exactly once.
- [ ] `server/test/tooling/build.test.ts` gains a case for the repeated build.

## Notes / context

Found during the LAI-024 review by running the build three times.

**Not urgent, and the reason matters:** the *correct* paths are always right, and
the nested copies are inert — `migrate.ts` resolves the folder from
`import.meta.url` and Drizzle reads only that folder's `meta/_journal.json`, so
the nested `migrations/migrations/` with its own journal is never read. Verified
against a real run: 18 tables, `__drizzle_migrations` had exactly 2 rows. Docker
builds a fresh context each time, so the container is unaffected. This bites a
developer running `pnpm build` twice locally, and it makes `dist/` untrustworthy
as a build artefact.

Likely shapes: `rm -rf dist/static dist/db/migrations` before copying, or
`cp -R src/static/. dist/static/` (trailing `/.` copies contents, not the
directory), or a small Node copy step. Whichever — the criterion is the
idempotency assertion, not the mechanism.

No new dependencies.
