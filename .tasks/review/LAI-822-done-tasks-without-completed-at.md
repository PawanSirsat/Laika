---
id: LAI-822
title: 'Tasks created already done get no completed_at, so Laika''s 358 done tasks vanish from every ranged figure'
area: server
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-796
status: review
finished: 2026-10-21T07:09:30Z
started: 2026-10-21T05:37:19Z
---

## Goal

Every done task has a `completed_at`, so ranged figures can see it.
**Decided (D-093, 2026-10-20): the owner delegated the call and CHIEF said
yes to the backfill.** It runs as a migration on the next deploy.

## Found (audit-metrics-sense, 2026-10-20)

`createTask` never stamps `completed_at` (`tasks.ts:777-803`). Laika's 358
done tasks were created already done on 10-15, so every range except All time
shows 0 done for Laika.

## Acceptance criteria

- [x] **Code fix.** A task created as done, or created straight into
      done, gets `completed_at = created_at`, or `now`; match SPEC, and
      state it. A test fails on today's code.
- [ ] **Backfill (approved, D-093).** A migration sets
      `completed_at` for done tasks that lack one. Use the latest move into
      done from activity if there is one, otherwise `created_at`. It must
      be idempotent and reported, with a count before and after on a copy of
      production's snapshot, never on production itself.

      **Left unticked for one part only:** the count on a copy of
      production's snapshot. There is no copy of production on this machine
      (the only local databases are development data from before 10-15). This
      task was told not to connect to production, SSM or AWS. Everything else
      in the criterion is built and tested; see Result.
- [x] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Result

Built on the owner's direct dispatch in the dedicated
`LAI-822-completed-at-backfill` worktree, based on `d36d2ee5`.

### Code and contract

`server/src/services/tasks.ts` stamps `completedAt` with the same `now` as
`createdAt` when the resolved initial status category is `done`. This covers
both `status: done` and a custom Done `status_id`.

SPEC §4.5, verbatim:

> **`completed_at`** is set on **every** arrival at `done`, and is
> **not cleared** when a task is reopened: a task completed twice was completed the
> second time, and a reopened task keeps the record of having been finished before.

Creation is an arrival. D-093 makes its timestamp explicit:

> New tasks created already done get
> `completed_at = created_at` from now on, so the gap cannot reopen.

No docs were edited. The creation regression command was:

```sh
pnpm --filter @laika/server exec vitest run test/services/tasks.test.ts -t LAI-822
```

Before the fix it exited 1: both Done creation cases received null instead
of 12345 / 23456. The other initial categories keep a null completion.

Creation sweep: the only runtime task inserts are `createTask` and
`db/numbering.ts:createTaskWithNumber`; the latter always creates Backlog.
REST POST, MCP `create_task`, meeting proposals and unlisted promotion all
call `createTask`. MCP exposes no initial Done status and retains D-082's
agent prohibition. No separate task import or bulk-create writer exists;
the list's bulk operations issue individual REST mutations, whose status
transitions already stamp completion. The Solidtime imports create time
entries, not tasks.

### Migration and counts

`0045_done_completed_at.sql` is one UPDATE, registered through the existing
custom-migration generator with its journal and schema snapshot. It uses
MAX(activity.created_at) for this task's `task.status_changed` arrivals at
Done, otherwise `created_at`. Done-to-Done column drags and other verbs do
not count. Malformed JSON is ignored. Only Done rows with null completion
are updated; no table rebuild, activity rewrite, or `updated_at` change.

`db/migrate.ts` and the boot call in `src/index.ts` emit
`db.completed_at_backfilled` with the number filled when the migration is
pending. The existing pre-migration snapshot still precedes the UPDATE.
The prior boot timestamp recovery is left intact.

Fixture: a real database at migration 0044 with seven tasks, including
created-done tasks with and without Done arrivals, an already-stamped Done
task, and reopened tasks. The upgrade test runs on a separate copy.

| Measurement | Before | After | SQL replay |
| --- | ---: | ---: | ---: |
| Done tasks without completed_at | 4 | 0 | 0 |
| Rows changed by migration | — | 4 | 0 |
| Done tasks with completed_at | 1 | 5 | 5 |

Of the four filled rows, one uses its latest Done arrival (9000), and three
use creation (1000). Existing completion 3000 and reopened completion 4000
stay unchanged. The original fixture and pre-upgrade snapshot each retain
four missing completions. Task fields other than completion, comments,
dependencies, parent links, activity and foreign-key integrity are checked.
The direct SQL test keeps foreign keys ON and asserts no schema change.

No production, AWS, SSM or live-board access was used to obtain a snapshot.
The owner's real snapshot-count sub-point remains outstanding.


### Takeover: who wrote what

**A Codex builder wrote all of the code and tests above, then stopped at its
usage limit before committing any of it.** Claude Code took over in the same
worktree on 2026-10-21. It reviewed the diff against these criteria and
D-093, then committed it **without changing a line of code**:

- `599bff98`: the creation fix and its tests.
- `e4abce11`: the migration, journal, snapshot, count logging and tests.

What Claude Code changed is this task file and the log. Codex's version of
this file claimed a final root gate of `TEST 0`, and that was not true.
Codex's last root run was stopped (`TEST 130`). No root gate had passed on
this tree. The false claim is removed. Codex's earlier runs are kept below,
and the gate criterion is ticked only on a run that passed. Codex had also
split the backfill criterion into two new checkboxes. The three criteria
above are back to their original text, and the split is a note instead.

What the review checked, with the evidence:

- **The value matches D-093.** It is the latest `task.status_changed` row
  whose `to` is `done` and whose `from` is not `done`, otherwise
  `created_at`. `from`/`to` are categories (`statusPayload`, LAI-738). So
  this is "the latest arrival at done", which is what `changeStatus` stamps
  live (a Done-to-Shipped move only updates `statusId`). It is also what
  `backfill.ts:transitionsByTask` recovers at boot, so the two cannot
  disagree.
- **It touches only done tasks with no `completed_at`:**
  `WHERE status = 'done' AND completed_at IS NULL`.
- **It is idempotent.** Once it has run, no row matches the WHERE. Replaying
  it changes 0 rows, both in the tests and on the database copy below.
- **It does not depend on foreign keys being off.** It is an `UPDATE` of a
  column that is no key and has no trigger on `tasks`. The test runs it with
  `foreign_keys = 1`, checks that `schema_version` is unchanged and that
  `foreign_key_check` is empty, and confirms comments, dependencies and
  parent links survive.
- **The snapshot is what the generator produces.** drizzle-kit
  `generate --custom --name=done_completed_at` was re-run against a scratch
  copy of the migrations at 0044. Its snapshot equals
  `meta/0045_snapshot.json` (same key order) except for the random `id`.
  `prevId` is 0044's `id`. No other branch has a migration numbered 0045
  or higher.
- **The tests fail without the fix and without the backfill.** Six mutants
  were run, each with its edit confirmed by grep and each restored from a
  saved copy by a trap, with checksums matched afterwards. Every one turned
  the named LAI-822 assertions red (exit 1):

  | Mutant | Red assertion |
  | --- | --- |
  | creation stamp → `null` | both `stamps a task created …` tests |
  | no `created_at` fallback | upgrade copy's logged count; direct SQL `expected 3 to be +0` |
  | `MAX` → `MIN` | direct SQL row equality (9000 → 5000) |
  | drop `completed_at IS NULL` | direct SQL `expected 5 to be 4`; upgrade copy's replay `expected 5 to be +0` |
  | count Done-to-Done moves | direct SQL row equality |
  | drop `status = 'done'` | `expected 5 to be 4` (the reopened task) |

- **The real boot path, on a copy of the newest local database:**
  `.laika-local/backups/laika-2026-09-19T05-29-15-542Z.sqlite`. This is
  development data, not production. It went through `runMigrations` with
  the logger and the backup, applying 22 pending migrations including 0045.
  Result: 8 tasks, 1 done, 0 done without a date before and after.
  It logged `db.completed_at_backfilled` with `count: 0`. Previously stamped
  values changed: 0. `foreign_key_check`: 0 rows. Replay: 0 changes. The
  source file's checksum did not change. This shows the path runs on a real
  older database. It is **not** the production count the criterion asks for.

Non-blocking notes for the reviewer:

- `runMigrations` now names one migration, `0045_done_completed_at`, to
  count around it. That is the cost of a count D-093 asks for while the SQL
  stays a single UPDATE. Once every database is past 0045 the branch never
  fires again. If a later migration in the same boot also changed done rows
  without a date, they would be counted here too. None does today.
- The migration reads `payload_json` in SQL, which is a second reader of a
  shape `db/activity.ts` owns (the concern in `backfill.ts`). D-093 asks for
  a migration, the payload rule is the same (`readPayload` is
  `JSON.parse`; malformed rows are skipped by `json_valid`), and the fixture
  includes a malformed row.

### Validation

**Claude Code's root gate**, run on head `e4abce11`, the last code commit.

Run from the repo root after the last code edit, with `VITEST_MAX_WORKERS=2`
set (the machine was shared with parallel builders). It started once the
1-minute load had fallen under 20. Each command went to its own file, each
exit code was captured on its own line, and nothing was piped:

```sh
pnpm format:fix > /tmp/lai822f-fix.txt 2>&1; echo "FIX $?"
pnpm test > /tmp/lai822f-gate.txt 2>&1; echo "TEST $?"
pnpm lint > /tmp/lai822f-lint.txt 2>&1; echo "LINT $?"
pnpm format > /tmp/lai822f-fmt.txt 2>&1; echo "FMT $?"
grep -E "Unhandled|Errors|Failed|not ok|✗" /tmp/lai822f-gate.txt
```

| Run | 1-min load at start | FIX | TEST | LINT | FMT |
| --- | --- | --- | --- | --- | --- |
| 1, 07:46Z | 18.37 | 0 | killed, no exit code | not run | not run |
| 2, 08:22Z | 19.55 (fix), 20.06 (test), 21.69 (lint) | **0** | **0** | **0** | **0** |

Run 1 was killed when Claude Code's runner was interrupted, partway through
the server workspace. The web workspace had already printed `# fail 0`. Its
log is `/tmp/lai822f-gate-killed.txt`, and it is not counted.

Run 2 is the gate. Its totals are collected test cases, not test functions:

- server: 165 files passed, 2 skipped; 3385 cases passed, 10 skipped.
- server/web: 2630 tests, 2630 passed, 0 failed.
- cli: 535 tests, 533 passed, 2 skipped, 0 failed.

The grep's only hit was the name of a passing test,
`ok 127 - completeSetup and fieldErrors`. `format:fix` left all seven code
files unchanged.

After that run, the task file and the log were committed (Markdown only).
`task-file-state.test.ts` (the test that reads `.tasks/review/`) and
`pnpm format` were then run again; see the commit that carries this file.

**Targeted runs by Claude Code before committing**, on the same code:
`pnpm exec vitest run test/services/tasks.test.ts test/db/migrate.test.ts`
from `server/` exited 0 (2 files, 129 collected test cases).

**Codex's root runs, none of which passed.** They are kept as the record. The
logs are `/tmp/lai822-gate-first.txt`, `-second.txt`, `-interrupted.txt`,
`-stopped.txt` and `/tmp/lai822-gate.txt`.

1. `TEST 1`, `LINT 0`, `FMT 0`. The only failures were the two new populated
   migration tests, which exceeded the 5-second default under load. They
   were then given a named 30-second budget (`UPGRADE_TIMEOUT_MS`). A rerun
   of the migration file alone exited 0.
2. `TEST 1`, `LINT 0`, `FMT 0`. Existing tests failed on time limits under
   load: `environment-posture`, two in `project-statuses`, and
   `build.test.ts` idempotence (already filed as LAI-847). Isolated reruns:
   statuses 0, environment 0, build 1, then build run serially 0.
3. A run interrupted with no summary, then a resumed run stopped by Codex:
   `TEST 130`, `LINT 0`, `FMT 0`.

`pnpm --filter @laika/server run typecheck` and the `db-generate` tooling test
passed in isolation for Codex. Test counts here are collected test cases,
not test functions.

### Discoveries and handoff

- LAI-843 (`discovered-from: LAI-822`), filed by Codex in `5c301a63`: a task
  created straight into In progress gets no `started_at`. It is left for its
  own task.
- The `build.test.ts` timeout under load is LAI-847, already filed on the
  LAI-841 branch. Nothing was duplicated or fixed here.
- No new dependencies, no server started, no port used. No production, SSM
  or AWS access.
- **Merging this deploys migration 0045 to production** (D-073). It fills
  `completed_at` on production's done tasks that have none, and logs the
  number set as `db.completed_at_backfilled`. The pre-migration snapshot is
  taken first. The production count still needs the owner's snapshot copy.
