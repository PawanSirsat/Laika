---
id: LAI-028
title: '`pnpm build` is not idempotent — a second run nests the copied assets'
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-024
status: review
started: 2026-08-24T04:41:57+05:30
finished: 2026-08-24T04:44:01+05:30
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

- [x] Running `pnpm build` twice in a row, with no clean between, produces a
      `dist/` tree **identical** to a single clean build. Assert it — e.g.
      compare `find dist | sort` across the two runs.
- [x] `dist/static/static/` and `dist/db/migrations/migrations/` never appear.
- [x] The fix does not weaken LAI-024: `fallback.html` and the generated
      migrations still land beside the compiled modules, and the built server
      still serves the SPA fallback and applies migrations exactly once.
- [x] `server/test/tooling/build.test.ts` gains a case for the repeated build.

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

---

## Notes at review — builder-a

**The fix had already landed before this task was claimed.** I hit the same bug
from the other side during LAI-006: migration `0002` appeared, and LAI-024's build
test failed with `0002_idempotency_keys.sql` missing from `dist/`, because the
second build had nested everything one level down. `build` gained a `clean` step
in commit `fdeb913`'s parent, under LAI-006, and that review note says so.

So what this task adds is the part that was missing — **the tests**, which is
AC4 and the reason it was worth claiming rather than closing as already-fixed.

**Verified the tests bite.** With `clean` removed from `build`, four of them fail:
the identical-tree comparison, the nesting check, the duplicate-journal check,
and the stale-output check. Restored, all ten pass. A regression test for a bug
that is already fixed is worth exactly as much as its ability to fail.

**Four cases, not one:**

1. `find dist | sort` identical across build 1, 2 and 3 — AC1, and the general
   statement of the property.
2. `dist/static/static/` and `dist/db/migrations/migrations/` never appear — AC2,
   the specific shape this bug took.
3. Exactly one `_journal.json` under `dist/db`. The nested copy carried a second
   one. Your notes are right that it was inert — Drizzle reads only the folder it
   resolves — but a second migration journal in a shipped artefact is the kind of
   thing that is harmless right up until someone changes how the folder is
   resolved.
4. A stray file written into `dist/` is gone after the next build. That is the
   other half of what `clean` buys and it would not have been caught by the first
   three.

**Why I claimed this before LAI-023**, which is the lower id at the same
priority: the fix was already sitting on my branch from LAI-006, so leaving this
in the backlog meant the next session to claim it would find the bug already gone
and have to work out why. Deviating from strict id order seemed better than
stranding a task in that state. Say if you would rather I had not.

**Cost note:** `test/tooling/build.test.ts` now runs four full builds and takes
about 13 seconds — most of the suite's wall time. Worth it for a production-only
failure mode, but if it becomes annoying the repeated-build cases are the ones to
move behind a flag.
