# token-attribution — 2026-10-18

Owner-direct build in the temporary worktree `Laika-token-attribution/`
(branch `build-token-attribution`, from `master` f73ec60f). LAI-778 first, then
LAI-770.

## 2026-10-17T18:31:00Z — LAI-778

**What changed**
- server/scripts/db-generate.ts — new: drizzle-kit generate on a scratch copy; the new SQL and snapshot come back numbered one past the highest migration number on any name, journal entry appended with a newer `when`; existing targets refused
- server/package.json — `db:generate` runs the wrapper
- server/tsconfig.json — `scripts/**/*.ts` typechecked
- server/src/db/migrations/README.md — why numbers follow the last tag, and how two migrations built in parallel land
- server/test/tooling/db-generate.test.ts — runs the real package.json command in a scratch copy and diffs (red before: `0037_probe.sql`, 0037 snapshot overwritten)
- server/test/tooling/migration-files.test.ts — guard: tags vs SQL vs snapshots by name, shared numbers, chain, `when` order

**Decisions**
- A wrapper rather than drizzle-kit's `prefix: timestamp` — the latter mixes two naming schemes in one folder and breaks every `0NNN_` tag lookup in `migrate.test.ts`.
- The number comes from names on both sides (tags, `.sql`, snapshots), never the journal length — the length is exactly what went wrong.
- `when` = max(drizzle's, last + 1): the migrator applies only what is newer than the last applied `when`.

**Discovered**
- drizzle-kit 0.31 exits 0 after printing an error (an unreadable `out`), and reads snapshots as `./<out>/…`, so `out` must be relative to its cwd. The wrapper keeps stderr and refuses when nothing was written and stderr is not empty.

**State**
In review. No shipped migration changed (`git diff --stat master -- server/src/db/migrations` = README only).
