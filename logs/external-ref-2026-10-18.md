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
