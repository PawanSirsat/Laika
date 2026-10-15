---
id: LAI-747
title: '`activity` append-only can be bypassed by INSERT OR REPLACE'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-743
status: backlog
---

## Goal

`activity` is append-only (§4.8) by two triggers, `BEFORE UPDATE` and `BEFORE
DELETE`. `INSERT OR REPLACE` (or `REPLACE INTO`) over an existing `id` deletes
the old row and inserts the new one, and SQLite fires delete triggers for a
replace **only when `recursive_triggers` is on** — it is off, SQLite's default.
So a replace rewrites an audit row in place.

Measured 2026-10-15 on a fresh migrated database (LAI-746's probe): an
`INSERT OR REPLACE INTO activity … VALUES (<existing id>, …)` succeeded and the
row's `payload_json` read back rewritten.

`member_ratings` had the same hole and LAI-746 closed it with a `BEFORE INSERT`
trigger that aborts when `NEW.id` already exists, kept by
`ensureActivityTriggers` at boot. The brief for LAI-746 said to leave
`activity` alone and file it.

## Acceptance criteria

- [ ] A replace over an existing `activity` id aborts, by a trigger the boot
      step (`ensureActivityTriggers`) re-establishes and verifies, as it does
      the other two.
- [ ] A test writes a row, attempts `INSERT OR REPLACE` and `REPLACE INTO` over
      it, and reads the original back unchanged; shown red without the trigger.
- [ ] The `rowid` cursor the SSE stream uses is not disturbed (§11.5).

## Notes / context

Only `activity`'s primary key can be collided with — check whether any other
UNIQUE constraint exists on it before relying on an id-only `WHEN`. Same
mechanism as `member_ratings_is_append_only_no_replace` in
`server/src/db/migrate.ts`.
