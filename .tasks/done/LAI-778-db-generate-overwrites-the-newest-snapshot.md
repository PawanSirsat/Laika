---
id: LAI-778
title: 'pnpm db:generate overwrites the newest migration snapshot: tag numbers run one ahead of the journal index since 0036'
area: server
assignee: owner-direct
priority: p2
depends-on: []
discovered-from: LAI-769
status: done
started: 2026-10-17T18:26:01Z
finished: 2026-10-17T18:30:26Z
---

## Goal

`drizzle-kit generate` names a new migration by its **journal index**, not by
the number of the last tag: at idx `n` it writes `000n_<name>.sql` and
`meta/000n_snapshot.json` (drizzle-kit 0.31, `writeResult`). LAI-771's
`0036_task_estimates` sits at **idx 35**, so every tag since runs one ahead of
its index — LAI-769's `0037_token_usage` is idx 36. The next
`pnpm db:generate` therefore:

- writes a second `0037_*.sql` beside `0037_token_usage.sql`, and
- **overwrites `meta/0037_snapshot.json`** with its own — the snapshot the
  next diff after it is computed from, and the `prevId` chain's last link.

Measured on a scratch copy of the folder after LAI-769 (`drizzle-kit generate
--custom --name probe`): `0037_probe.sql` written, `0037_snapshot.json`
overwritten, journal entry `idx 37, tag 0037_probe`. On `master` before
LAI-769 lands, the same command writes `0036_*` over `0036_snapshot.json`.
Nothing is wrong yet — no shipped file is affected and the migrator reads
only the journal and the SQL — but the next author to run the documented
command gets a damaged folder, silently, and a review of their diff shows it
only as a one-file modification of a snapshot.

When this is done, `pnpm db:generate` produces a migration whose number
follows the last tag and leaves every existing file alone, or refuses.

## Acceptance criteria

- [x] Running the repo's generate command after the last migration writes a
      new SQL file and a new snapshot under a number no existing file has,
      and modifies no existing file but the journal (a test or a script that
      runs it against a copy of the folder and diffs).
- [x] A guard that fails if a migration's snapshot file is missing or two
      migration files share a number — names from both sides (journal tags and
      files on disk), never a count.
- [x] `server/src/db/migrations/README.md` says how a migration is generated
      when two are built in parallel, as LAI-769 and LAI-771 were.
- [x] No shipped migration's SQL or journal `when` changes (§README: applied
      migrations are history).

## Notes / context

- How LAI-769 got around it: generated against a scratch copy of the folder,
  placed the output at 0037 (its merge commit, 422adb19, and its log). A
  second generate over the result: "No schema changes"; `drizzle-kit check`:
  fine.
- Possible shapes, not decided: a `db:generate` wrapper that generates in a
  temporary copy and places the files at `last tag + 1`; or drizzle-kit's
  `migrations.prefix` (`timestamp`/`unix`) for new migrations, if the migrator
  and `migrate.test.ts`'s tag lookups tolerate mixed prefixes — check before
  choosing.
- No new dependencies.

## Builder notes (at review)

- **Shape: a wrapper, not drizzle-kit's `prefix` setting.** `server/scripts/db-generate.ts`
  (what `pnpm run db:generate` runs now) copies the folder to a scratch
  directory, runs drizzle-kit there, and brings back only the new `.sql` and
  snapshot, numbered **one past the highest number any migration name
  carries** (journal tags, SQL files and snapshots), with the journal entry
  appended and `when` = max(drizzle's, last + 1). A target that exists is
  refused. `prefix: timestamp` was not taken: it would mix two naming schemes
  in one folder and every `0NNN_` tag lookup in `migrate.test.ts`.
- **drizzle-kit exits 0 after printing an error** (seen: an `out` it could
  not read). The wrapper keeps its stderr and refuses when no migration was
  written and stderr is not empty; the no-change test asserts drizzle-kit's
  own *No schema changes* so a crash cannot pass for it.
- **Red first:** `test/tooling/db-generate.test.ts` runs the command read from
  `server/package.json` in a scratch copy; against bare `drizzle-kit generate`
  it failed with `expected [ '0037_probe.sql' ] to deeply equal [ '0038_probe.sql', … ]`.
  The guard (`test/tooling/migration-files.test.ts`) passes on the folder as
  shipped; mutations shown red: the bare command's output in the real tree
  (shared number + broken chain, 2 of 5 red), and `meta/0037_snapshot.json`
  moved aside (missing snapshot + chain red). Both restored by name.
- No shipped file changed: `git diff --stat master -- server/src/db/migrations`
  is the README only.
- Verified: `cd server && npx vitest run test/tooling/migration-files.test.ts
  test/tooling/db-generate.test.ts test/db/migrate.test.ts
  test/tooling/schema-migration-drift.test.ts test/tooling/structure.test.ts`
  → 5 files, 59 tests passed, exit 0; `pnpm run typecheck` 0; eslint and
  prettier on the touched files 0; `pnpm run db:generate` in the tree: *No
  schema changes*, nothing written. The root gate runs once at the end of
  this branch, after LAI-770 (`logs/token-attribution-2026-10-18.md`).

## Accepted

2026-10-18: accepted by CHIEF (Omnigent) with LAI-770, after the same review: `pnpm db:generate` runs drizzle-kit on a scratch copy and copies back only the new files, numbered past the highest existing number, refusing an existing target and failing when drizzle-kit prints an error. No shipped migration changed.
