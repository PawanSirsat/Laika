---
id: LAI-003
title: Drizzle + SQLite setup and the first migration
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-001]
discovered-from:
status: backlog
---

## Goal

The full v1 schema from SPEC §4, expressed in Drizzle, with a generated
migration that applies on boot against a WAL-mode SQLite file. Everything that
persists anything depends on this being right, so get the shape right now rather
than migrating it three times.

## Acceptance criteria

- [ ] `better-sqlite3` client opened with `journal_mode=WAL`, `foreign_keys=ON`,
      `busy_timeout=5000`, `synchronous=NORMAL`. DB path from `LAIKA_DB_PATH`,
      default `/data/laika.db`, falling back to `./data/laika.db` in dev.
- [ ] Drizzle schema for every table in SPEC §4: `users`, `orgs`, `projects`,
      `project_memberships`, `tasks`, `task_dependencies`, `comments`,
      `activity`, `tokens`, `heartbeats`, `invites`.
- [ ] Ids are ULID `text`; timestamps are `integer` unix-ms; FKs declared with
      the right cascade behaviour.
- [ ] Every index in SPEC §4.11 exists in the migration.
- [ ] `drizzle-kit` configured; the first migration is **generated and
      committed**, and applied automatically on server boot (forward-only).
- [ ] Per-project task numbering produces `LAI-1`, `LAI-2`, … without gaps under
      concurrent inserts (transaction, not `MAX(number)+1` read-then-write).
- [ ] The `activity` table is append-only: a repository/helper layer that offers
      no update or delete path, plus a test asserting attempts fail.
- [ ] `task_dependencies` rejects self-reference and cycles at write time, with
      tests.
- [ ] Tests run against a fresh in-memory/temp SQLite with migrations applied.

## Notes / context

Milestone: **M1**. Explicitly **not** in this task: auth tables, which belong to
better-auth (LAI-005) — do not hand-write `sessions` or password columns. SPEC §4 is the source of truth for columns; read it fully
before starting. `ready` is **derived, not a column** (§4.5) — do not add it.
`discovered_from_task_id` is provenance and does **not** block.

Dependencies this task may add: `drizzle-orm`, `drizzle-kit`, `better-sqlite3`,
`@types/better-sqlite3`, `ulid`.
