# capacity-load — 2026-10-20

Owner-direct builder dispatched by polly, worktree `Laika-capacity`, branch
`LAI-818-capacity-load`. No local server was started; no port was used.

## 2026-10-20T19:20:00Z — LAI-818

**What changed**
- server/src/services/presence.ts — `loadOf` reads `committed` (in progress + to do); `CapacityWorkload` gains `backlog` and `committed`, `todo` is To do only; each `CapacitySpace` carries its own `load`; spaces sort by committed; new gated `activity_14d_split` (`by_self`, `by_agents`, `bookkeeping`) from the §4.22 rollup less a bookkeeping count over `activity_org_created_at_idx`
- server/test/services/presence.test.ts — the D-092 cases (100 in review is no load, backlog apart, overdue alone not Heavy, per-space load, the split, the query plan)
- server/web/src/api/presence.ts — client mirror of the new shapes, `ActivitySplit`
- server/web/src/routes/screens/capacity/capacity-derive.ts — `loadIn`; the Heavy chip and the load sort read the chosen space's load; bar and Team load on committed work; overdue no longer orders the load sort; badge `none` reads "No load"
- server/web/src/routes/screens/capacity/CapacityCard.tsx, CapacityScreen.tsx, capacity.css — counts in progress · to do · backlog, waiting on reviewers and due soon apart, an overdue badge, committed space chips with backlog on hover, the activity split, the 200+ tile, the rule and definitions in words
- server/web/src/api/use-review-count.ts, components/shell/{shell-context.ts,ShellProvider.tsx,ScreenOutlet.tsx} — `capped` from `GET /review`'s `truncated`, passed to Capacity
- server/web/test/api/presence.test.ts — field-by-field drift check for `CapacityWorkload`, `CapacitySpace`, `ActivitySplit`
- server/web/test/routes/screens/capacity/capacity-derive.test.ts, test/browser/capacity.test.ts, test/browser/capacity-org.ts, test/browser/store-requests.test.ts — new shape, per-space badge, counts apart, split, 200+
- docs/SPEC.md — named edits: §9.3 (Capacity `workload`, `load` with thresholds 5/15/2/5 on committed work, `activity_14d_split`) and §11.4.2.1 (the Capacity screen)

**Decisions**
- The server sends each space's load rather than the web re-deriving it from counts — one rule in one place; the web only picks which load to show.
- Bookkeeping is shown apart, not dropped: the rollup has no verb, so excluding it from the heatmap would mean a migration and a change to §4.22's meaning. One windowed count from the log, subtracted per kind, keeps the three figures summing to the series.
- "By hand" for `by_self` rather than the task's "by you": the card is about any person, and "by you" is wrong on everyone else's.
- The review tile says "200+" from `truncated` instead of adding a server `total`: LAI-820 already owns the true total and the Inbox badge; adding `total` here would have meant rewriting every review stub in six browser tests owned by other screens.
- The "No work" chip still means nothing assigned at all (`open === 0`); only the badge's `none` was relabelled "No load", since a person with 209 in backlog has work but no load.

**Discovered**
- `start_working` with `LAI-818` answered `not_found` while `get_task_context LAI-818` found the card; `LAIKA-618` worked. Both tools call `resolveTaskRef` on master, so no cause was found in code → logged with `log_unlisted_work`, not filed as a task.
- The root `pnpm test` runs the three workspaces in parallel and `pnpm -r` stops at the first failure, so on a hot machine a timing failure in one workspace hides whether the others pass (server never finished in either root run). Each workspace's own `pnpm test`, run in turn, was the complete answer: server 0, web 0, cli 0.
- `store-requests.test.ts` carried its own capacity fixture in the old workload shape. A reshaped payload breaks any hand-built fixture outside `capacity-org.ts`; grepping for `workload: {` in tests found it, after the gate did.
- The sidebar Inbox badge still shows the capped 200 — LAI-820 already covers it.

**State**
Moved to .tasks/review/. Gate criterion left unticked with the exit codes explained in the task file. Not pushed.
