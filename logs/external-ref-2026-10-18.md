# external-ref — 2026-10-18

Owner-direct build in a temporary worktree (`Laika-external-ref`, branch
`build-external-ref` from `master` 90ed0358), dispatched by the orchestrator.

## 2026-10-17T21:03:29Z — LAI-780

**What changed**
- .tasks/review/LAI-780-this-repo-ties-no-tokens-to-its-tasks.md — claimed with the owner's decision (option 1) and the criteria rewritten to it before any work; moved to review with builder notes
- server/src/services/outside-ids.ts — new: the outside-id shape, normalising (upper-case, 422 on `external_ref`), readable matches only, the 422 `ambiguous` refusal, and the prefixes of outside ids on readable cards
- server/src/services/tasks.ts — `resolveTaskRef(db, ref, actor?)`: board key first, then the outside id among readable projects; create/update take `external_ref`
- server/src/mcp/write-tools.ts, server/src/mcp/read-tools.ts — every task ref passes the caller; `create_task`/`update_task` take `external_ref`
- server/src/http/routes/tasks.ts — POST/PATCH bodies take `external_ref` (loose 120 bound; the service shapes it)
- server/src/services/token-usage.ts, server/src/http/routes/local-activity.ts — a usage key that names no task is tried as an outside id; the row pattern widens to that shape
- server/src/services/local-activity.ts — `task_prefixes` adds the outside-id prefixes the caller may read
- server/src/services/webhooks.ts — a PR's `owner/repo#N` is never written over an outside id
- server/src/db/schema.ts, server/src/db/migrations/0038_tasks_external_ref_index.sql (+ meta/0038_snapshot.json, _journal.json) — partial index `tasks(external_ref, project_id) WHERE external_ref IS NOT NULL`, via `pnpm db:generate`
- server/scripts/backfill-external-ref.ts — new, not run: sets `LAI-NNN` from `LAI-NNN · …` titles where `external_ref` is empty; dry run unless `--apply`
- cli/src/activity-usage.ts, cli/README.md — marks and branch keys in the outside-id shape; a branch run is read for every key it ends in after an underscore
- server/web/src/api/tasks.ts, server/web/src/api/board-derive.ts, server/web/src/routes/screens/BoardScreen.tsx, server/web/src/routes/screens/task/TaskMeta.tsx — Outside id row (read; edit/clear for editors), PR row only for a non-outside-id ref, search by outside id
- docs/SPEC.md — §4.5 `external_ref`, §4.13 the index, §6.4 bodies / `task_prefixes` / the usage key, §7 and §7.1
- tests: server/test/services/outside-ids.test.ts (new), server/test/tooling/backfill-external-ref.test.ts (new), server/web/test/browser/task-outside-id.test.ts (new); additions to token-usage, tasks (service and route), usage route, webhooks route, MCP write-tools, schema, cli attribution, web board-derive and api/tasks; task-panel's Details label list

**Decisions**
- Ambiguous is `422` with `details.reason: 'ambiguous'` and the keys, not `409` — `conflict` already means "someone else holds it" on `start_working`, and an agent branching on the code would misread it.
- A board key always wins and never falls through to an outside id, even when the caller cannot read the board's task — the alternative made the answer depend on visibility, and kept the old `not_found`/`forbidden` from meaning what it meant.
- Stored upper-case and matched by upper-casing the input, rather than a NOCASE index — one plain index search, and no prod value of the shape exists in another case (only the webhook wrote the column, and its values never fit).
- The webhook guard was added to the criteria before work started: without it the first PR on a backfilled card erases its `LAI-NNN`.
- In a usage report an ambiguous id is unattributed, not refused — refusing would drop a machine's whole day for one key.
- The shape is validated in the service, routes and tool schemas only bound it at 120 — an equal bound in the route would shadow the service's message (shadowed-bounds).
- The backfill skips an id two titles share or another card already holds — writing it would make every lookup by it ambiguous.

**Discovered**
- `external_ref` was not writable through REST or MCP at all before this; only the PR webhook wrote it (`owner/repo#N`). → nothing filed; the shared column is described in §4.5.
- My impact check missed `task-panel.test.ts`, which pins every Details label in order; the root gate caught it in run 1. Same lesson as "a truncated answer reads as complete", from a grep I never ran: I searched for tests of what I changed, not for tests that enumerate the screen I added to.
- The collector needed nothing for `LAI-780` itself — it already fit the key pattern; only the server's prefix list was missing. Its widening is for wider outside ids (`DATA_ENG-12`, prefixes past 8 characters).
- Load timeouts in three full runs, one per run and a different file each time: `migrate.test.ts` (LAI-768, twice), `build.test.ts`'s built-server health wait once. All green alone.
- The board card for LAI-780 could not be found by its repo id through MCP — the very gap this closes — so nothing was mirrored to the board.
- The panel's Tokens section still says "a branch named LC-3-…" without the outside id. Wording only. → not filed.

**State**
In .tasks/review/. lint 0, format 0; `pnpm test` 1 on each of three runs, each only a load timeout green alone. CLAUDE.md `## Laika`, the backfill run and the re-measure are CHIEF's.

## 2026-10-17T21:44:25Z — LAI-780 (review round 1)

**What changed**
- server/scripts/backfill-external-ref.ts — writes paced (2/s default, `--per-second`), a `429` (reads too) waits `Retry-After` and retries up to 5 times, injectable sleep, `{ planned, written, skipped, failed }`; a `422 taken` write is a skip naming the holder
- server/src/services/outside-ids.ts — `assertOutsideIdFree`: an outside id is one task's within its project, `422 taken` naming it
- server/src/services/tasks.ts — that check inside the create's write lock and the update's transaction; `assertTaskExists` for blockers
- server/src/mcp/write-tools.ts — `create_task` resolves and checks every blocker before it creates
- cli/src/activity-usage.ts — `DATA_V` 3: lines read under 2 are read again with the wider key shape
- cli/src/activity-sync.ts — the sharing answer's `task_prefixes` kept in the server's shape, not the board-key shape
- cli/test/support/local-activity-contract.ts — the stub board takes an outside id as a usage row's task, as §6.4 does
- docs/SPEC.md — §4.5 and §6.4 per-project uniqueness, §7.1 `create_task`'s blockers
- tests: backfill (+10), tasks service (+4), tasks route (+1), MCP write-tools (+2), token-usage (+1), cli attribution (+2); the backfill's three run tests now read `skipped`
- .tasks/review/LAI-780-…md — criteria added at review, review round section

**Decisions**
- Uniqueness compares the normalised (upper-case) value, not `upper(external_ref)` — every writer of an outside id stores it upper-case, so it is case-insensitive in effect and stays one index search; a lower-cased value could only come from a hand edit of the database.
- The check runs inside each write's transaction rather than before it, so two writes cannot both find the id free.
- A blocker is checked to exist, not to be readable — the same check `addTaskDependency` makes, moved earlier; tightening who may link what would be a different change.
- The backfill's control test (unpaced, unretried) is kept beside the 480-card test, so the simulated limiter is shown able to fail rather than assumed to.

**Discovered**
- `activity-sync.ts` dropped every outside prefix that is not board-shaped (`DATA_ENG`, `Q`, `PLATFORMOPS`) before the collector saw it, and the stub board's contract refused an outside-id row. Round 1's collector tests handed prefixes straight to `readUsage` and asserted what was sent, not what was accepted — "a fixture cleaner than reality" again. Found by the `DATA_V` test because it goes through `sync`; fixed here.
- `create_task` applies `sprint` after it creates, so an unknown sprint id would leave a filed task behind the error, as blockers did. Not run, not fixed; for CHIEF to file (no id range here).
- `build.test.ts`'s built-server health wait timed out under the full gate's load once more (alone 15/15).

**State**
In .tasks/review/ (round 1 fixed). At `000305f7`: test 0 (run 2; run 1 lost to the load timeout above), lint 0, format 0.
