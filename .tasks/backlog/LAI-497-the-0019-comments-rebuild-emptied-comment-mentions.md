---
id: LAI-497
title: 'The 0019 comments rebuild emptied comment_mentions on every upgraded instance'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-493
status: backlog
---

## Goal

Find out whether any deployed Laika database lost its `comment_mentions` rows
when it crossed migration `0019_natural_lockjaw`, and recover what can be
recovered from the comment bodies.

## What was found

LAI-493's rebuild of `tasks` was the first drizzle-kit table rebuild of a
table other tables reference with `ON DELETE CASCADE`, and `migrate.test.ts`
found the `task_dependencies` rows gone afterwards. The mechanism, verified
against drizzle's source (`sqlite-core/dialect`, `migrate`): **the migrator
opens `BEGIN` before running a file, and `PRAGMA foreign_keys` is a no-op
inside a transaction**, so the `PRAGMA foreign_keys=OFF` drizzle-kit writes
at the top of every rebuild never takes effect. `DROP TABLE` then performs its
implicit `DELETE FROM` with enforcement **on**, and every cascading row in a
referencing table goes with the old table, silently.

`runMigrations` now switches enforcement off outside the transaction and
asks `PRAGMA foreign_key_check` afterwards (LAI-493), so no future rebuild can
do this. **The past ones have already run.** A census of the rebuilds so far
against `schema.ts`'s cascades:

| migration | rebuilt | cascades into it | exposure |
| --- | --- | --- | --- |
| `0001` | `users` | `project_memberships`, `tokens`, `heartbeats`, `unlisted_work`, `sessions`, `accounts`, `task_watchers`, `comment_mentions` | ran before any instance held data, almost certainly; confirm |
| `0003`…`0017`, `0021` | `activity` | nothing references it | none |
| **`0019`** | **`comments`** | **`comment_mentions`** (created in `0011`, cascade) | **every instance upgraded across 0019 lost every mention row** |
| `0021`, `0022` | `meeting_reviews` | nothing references it | none |

## Acceptance criteria

- [ ] A test reproduces the loss on a database migrated to `0018`, populated
      with a mention, then migrated through `0019` **with the old migrator
      behaviour** — so the claim above is measured, not reasoned.
- [ ] A boot-time backfill, in the `backfillTaskTimestamps` shape, re-derives
      `comment_mentions` from `@`-handles in comment bodies for comments that
      have none, idempotently, and a test proves it runs from `runMigrations`.
- [ ] The `0001` exposure is confirmed one way or the other and recorded in
      the log.
- [ ] `server/src/db/migrations/README.md` says why a rebuild is safe now and
      what it cost before.

## Notes / context

The migrator fix and its test are in LAI-493 (`server/src/db/migrate.ts`,
`server/test/db/migrate.test.ts`). Whether a mention can be re-derived
depends on how `comment-mentions.ts` parses handles; if it cannot be, say so
and the backfill criterion becomes a note in the README instead.
