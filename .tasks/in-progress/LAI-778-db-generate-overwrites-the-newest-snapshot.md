---
id: LAI-778
title: 'pnpm db:generate overwrites the newest migration snapshot: tag numbers run one ahead of the journal index since 0036'
area: server
assignee: owner-direct
priority: p2
depends-on: []
discovered-from: LAI-769
status: in-progress
started: 2026-10-17T18:26:01Z
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

- [ ] Running the repo's generate command after the last migration writes a
      new SQL file and a new snapshot under a number no existing file has,
      and modifies no existing file but the journal (a test or a script that
      runs it against a copy of the folder and diffs).
- [ ] A guard that fails if a migration's snapshot file is missing or two
      migration files share a number — names from both sides (journal tags and
      files on disk), never a count.
- [ ] `server/src/db/migrations/README.md` says how a migration is generated
      when two are built in parallel, as LAI-769 and LAI-771 were.
- [ ] No shipped migration's SQL or journal `when` changes (§README: applied
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
