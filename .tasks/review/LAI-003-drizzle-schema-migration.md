---
id: LAI-003
title: Drizzle + SQLite setup and the first migration
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-001]
discovered-from:
status: review
started: 2026-08-24T03:20:36+05:30
finished: 2026-08-24T03:36:43+05:30
---

## Goal

The full v1 schema from SPEC §4, expressed in Drizzle, with a generated
migration that applies on boot against a WAL-mode SQLite file. Everything that
persists anything depends on this being right, so get the shape right now rather
than migrating it three times.

## Acceptance criteria

- [x] `better-sqlite3` client opened with `journal_mode=WAL`, `foreign_keys=ON`,
      `busy_timeout=5000`, `synchronous=NORMAL`. DB path from `LAIKA_DB_PATH`,
      default `/data/laika.db`, falling back to `./data/laika.db` in dev.
- [x] Drizzle schema for every table in SPEC §4: `users`, `orgs`, `projects`,
      `project_memberships`, `tasks`, `task_dependencies`, `comments`,
      `activity`, `tokens`, `heartbeats`, `invites`.
- [x] Ids are ULID `text`; timestamps are `integer` unix-ms; FKs declared with
      the right cascade behaviour.
- [x] Every index in SPEC §4.13 exists in the migration.
- [x] `drizzle-kit` configured; the first migration is **generated and
      committed**, and applied automatically on server boot (forward-only).
- [x] Per-project task numbering produces `LAI-1`, `LAI-2`, … without gaps under
      concurrent inserts (transaction, not `MAX(number)+1` read-then-write).
- [x] The `activity` table is append-only: a repository/helper layer that offers
      no update or delete path, plus a test asserting attempts fail.
- [x] `task_dependencies` rejects self-reference and cycles at write time, with
      tests.
- [x] Tests run against a fresh in-memory/temp SQLite with migrations applied.

## Notes / context

Milestone: **M1**. Explicitly **not** in this task: auth tables, which belong to
better-auth (LAI-005) — do not hand-write `sessions` or password columns. SPEC §4 is the source of truth for columns; read it fully
before starting. `ready` is **derived, not a column** (§4.5) — do not add it.
`discovered_from_task_id` is provenance and does **not** block.

Dependencies this task may add: `drizzle-orm`, `drizzle-kit`, `better-sqlite3`,
`@types/better-sqlite3`, `ulid`.

---

## Notes at review — builder-a

**Verified on a fresh clone of `builder-a`:** `pnpm install --frozen-lockfile` →
`typecheck` → `lint` → `test` (90 tests, 11 files) all exit 0. Then a real boot
against an empty `LAIKA_DB_PATH` in a directory that did not exist: the directory
and database were created, migrations applied, `journal_mode = wal`, both
append-only triggers present, 14 tables plus drizzle's journal, health answered,
`SIGTERM` → exit 0 with the WAL checkpointed away on close.

**1. The schema has 14 tables, not the 11 this task lists.** AC2 predates
§4.12 `meeting_reviews`, §4.14 `unlisted_work` and §4.15 `sprints`. This is not a
judgement call: **AC4 requires every index in §4.13**, and that list names
`unlisted_work(user_id, created_at)`, `meeting_reviews(project_id, status)`,
`sprints(project_id, starts_on)`, `sprints(project_id, status)` and
`tasks(sprint_id)` — none of which can exist without their tables. §4.5 also
gives `tasks` a `sprint_id` FK. D-011 ("the spec is authoritative; where a task
file and the spec disagree, the spec wins") settles it. AC2's list should be
corrected or dropped in favour of a citation.

**2. Deviation from §4.8: `activity.project_id` and `activity.actor_id` are
nullable.** §4.8 marks only `task_id` nullable, but four event types the same
section defines are not project-scoped (`token.created`, `token.revoked`,
`unlisted.logged`, org-level `member.added`) and several are not user-authored
(`webhook.commit` — §6.1's signature-authenticated system actor — and the cron
jobs of §11.6). Taken literally the schema could not store rows the spec
requires. `org_id` stays `NOT NULL`. **LAI-025 filed**; this is a spec-internal
contradiction, so D-011 does not resolve it.

**3. Append-only is enforced twice, on purpose.** The repository exposes only
`appendActivity`, `listActivity` and `readPayload` — asserted by a test that
fails if a mutating export ever appears. But absence of a method protects only
callers who use the module, so the migration also installs
`BEFORE UPDATE`/`BEFORE DELETE` triggers that `RAISE(ABORT)`. That is what makes
"a test asserting attempts fail" a runtime assertion rather than a type-level one.

**4. The concurrency test was checked for teeth, not assumed.** Four worker
threads, four independent connections to one file, 20 tasks each. It passes with
`BEGIN IMMEDIATE`. I then temporarily swapped in a deferred `BEGIN` and re-ran
it: **11 of 80 inserts failed with "database is locked"**. A deferred transaction
takes no write lock, so `SELECT MAX(number)` happens before the lock and
`busy_timeout` retries the write with a stale number. The test bites.

**5. Numbers are dense because they are derived inside the inserting
transaction.** A counter table would burn a number on every rollback; a test
asserts that a failed insert leaves the next number at 2, not 3.

**6. Two places use raw SQL through Drizzle's `sql` template, both in the db
layer and neither in a handler** (CLAUDE.md §5): the connection PRAGMAs, which
§11.3 names as the sanctioned exception, and the recursive CTE that detects
dependency cycles. The alternative to the CTE is one query per graph level.

**7. `db:generate` now also runs Prettier over `src/db/migrations`.** drizzle-kit
rewrites its metadata JSON unformatted on every generate, which would leave
`pnpm format` red until someone noticed.

**8. Filed while working:** LAI-025 (above) and **LAI-026** — `pnpm format:fix`
run from a builder worktree rewrites files in *every* area. I did this to
Builder-B's `plugin.json` during this task and caught it in `git status` before
committing. The check being repo-wide is right; the `--write` half crossing
worktree boundaries is not.

**9. Renumbering.** LAI-017/018/019, filed during LAI-002, collided with PM's UI
shell tasks of the same ids on `master` (`cc6fbed`). Mine moved to LAI-022/023/024
and every reference was updated.
